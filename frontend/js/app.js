// ── app.js — Entry point: boot, router, global search, sync button ────────────
//
// Control Center (v11.11.0, widened to all Super Admins 2026-09-04) is an
// additive surface consolidating Settings/Admin/Upload Center/System Logs.
// See .claude/skills/settings-architecture/skill.md and
// .claude/plans/i-was-working-on-idempotent-ritchie.md.
import { currentUser, isAdmin, isSuperAdmin, isPodAdmin, isSDR, authHeaders, API_BASE, dialerEnabled, isViewAsSession, getAuthToken } from './auth.js';
import { syncSalesforce, globalSearch, uploadSdrCsv, fetchDialerStatus, startDialerCall, getCallStatus, addLeadNote, getMyActiveCall, forceEndCall, getMyCapabilities } from './api.js';
import { showLoader, showToast, fullName } from './utils.js';
import { stackTopBanner, unstackTopBanner } from './top_banner_stack.js';

// renderDashboard removed — replaced by DashboardHub React IIFE (v9.6.0)

import { renderLeads, renderLeadDetail, setNavLeadsFromRaw } from './views/leads.js';
import { getNavLeads } from './views/lead_list.js';
import { renderDisqualifyRequests } from './views/disqualify_requests.js';
import { renderPods }       from './views/pods.js';
import { renderLeaderboard } from './views/leaderboard.js';
import { initModals, openCallModal, openNoShowModal, openDemoFailedModal, runLeadStageAction } from './views/modals.js';
import { showDialerWidget, showManualDialWidget, isWidgetActive, initIncomingCallWatcher } from './views/dialer_widget.js';
// Side-effect-only import: messenger_dialer.js's module body registers the
// TTL safety net, the beforeunload beacon, and window.AlternateMessengerDialer —
// that global (not this binding) is what every call site below reads, so
// whichever engine currently owns it (this vanilla one, or the React port
// when the messengerWidgetReact flag is on) is the one that actually
// drives a call. A bound import here would freeze every call to this
// vanilla module regardless of the flag — see dialerEngine.js's own
// comment on why that's unsafe.
import './messenger_dialer.js?v=20260729a';

import { renderSdrPerformance } from './views/sdr_performance.js';
import { getPhoneTimezone, renderPhoneLocalTime } from './phone_timezone.js'; // ENH-01

// Expose phone timezone utils for manual dial widget TZ preview
window._phoneTimezoneUtils = { getPhoneTimezone, renderPhoneLocalTime };
// metrics.js sunset — legacy 'metrics' route redirects to 'analytics' (line 352)
import { renderSdrSettings } from './views/sdr_settings.js';
import { fetchPendingTasks, snoozeTask, dismissTask, fetchPendingReplies, dismissReply } from './api.js';
import { runAiQuery, injectSmartAnalyticsStyles } from './views/smart_analytics.js';
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
let _messengerWidgetReady = false; // true only when MessengerWidget.init() completed successfully
window._messengerWidgetReady = false; // expose for lead_detail.js template render

const vc = document.getElementById('view-container');

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
        userEmail:   currentUser?.email || '',
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
                window.dispatchEvent(new CustomEvent('alternate:open-new-lead'));
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

    function _mountSandboxBanner() {
        if (localStorage.getItem('crm_is_sandbox') !== 'true') return;
        if (document.getElementById('sandbox-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'sandbox-banner';
        banner.style.cssText = 'background: linear-gradient(90deg, #152226 0%, #12181A 100%); border-bottom: 1px solid rgba(201, 255, 104, 0.25); color: #F4F6F2; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; z-index: 9999;';
        banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: rgba(201, 255, 104, 0.15); color: #C9FF68; font-size: 12px; font-weight: 800;">⚡</span>
                <span><strong>Interactive Sandbox Active</strong> — Previewing Alternate CRM with simulated commercial pipeline data.</span>
            </div>
            <button id="exit-sandbox-btn" style="background: rgba(201, 255, 104, 0.12); border: 1px solid rgba(201, 255, 104, 0.3); color: #C9FF68; padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                Exit Sandbox
            </button>
        `;
        document.body.prepend(banner);
        document.getElementById('exit-sandbox-btn')?.addEventListener('click', () => {
            localStorage.removeItem('crm_is_sandbox');
            localStorage.removeItem('crm_token');
            sessionStorage.clear();
            window.location.href = 'login.html';
        });
    }

    function _doMount() {
        const sidebarEl = document.getElementById('nav-sidebar-root');
        const topbarEl  = document.getElementById('nav-topbar-root');
        if (sidebarEl && topbarEl && window.NavHub) {
            window.NavHub.mount(sidebarEl, topbarEl, navProps);
            _mountViewAsBanner();
            _mountSandboxBanner();
        }
    }

    // ── View-As banner (impersonation mode) ─────────────────────────────────
    // Content is React (NavHub — see nav-entry.jsx's ViewAsBanner); this
    // function still owns the container + stacking (top_banner_stack.js) and
    // the exit redirect, same split as sidebar/topbar (app.js builds props +
    // callbacks, NavHub only renders).
    function _mountViewAsBanner() {
        if (!isViewAsSession) return;
        const banner = document.createElement('div');
        banner.id = 'view-as-banner';
        banner.style.zIndex = '9999'; // stackTopBanner sets position/left/right/top, not z-index
        window.NavHub.mountViewAsBanner(banner, {
            userName: currentUser?.name || currentUser?.email || 'User',
            userRole: currentUser?.role || 'Unknown',
            onExit: () => {
                mp.track('View-As Exited');
                sessionStorage.removeItem('crm_view_as_token');
                window.close();  // Close the View-As tab
                // Fallback if window.close() is blocked by browser
                window.location.href = 'login.html';
            },
        });
        stackTopBanner(banner);
        mp.track('View-As Entered', {
            target_name: currentUser?.name || currentUser?.email || '',
            target_role: currentUser?.role || '',
        });
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
    // A refused action (HTTP 4xx) carries the server's own reason, e.g. "already a member of 'US Team New'. Remove
    // them from that pod first." — show that, not a generic "refresh the page" that can't help. Anything else keeps
    // the generic message. (A button that handles its own errors never lands here.)
    const status = reason && reason.response && reason.response.status;
    const detail = reason && reason.response && reason.response.data && reason.response.data.detail;
    let message = 'Something went wrong. Please try refreshing the page.';
    if (status >= 400 && status < 500) {
        if (typeof detail === 'string' && detail.trim()) message = detail;
        else if (Array.isArray(detail)) message = 'Please check the details you entered and try again.';
        else message = "That didn't work. Please try again.";
    }
    try {
        showToast(message, 'error', status >= 400 && status < 500 ? 9000 : 6000);
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
    // 2026-09-09: the role-based nav show/hide that lived here is gone —
    // none of its 21 '<name>-nav-item' ids exist in index.html any more.
    // Nav visibility lives in NavSidebar.jsx's per-entry `roles` list.
    if (isSuperAdmin) {
        if (document.getElementById('sync-btn'))     document.getElementById('sync-btn').style.display = 'inline-flex';
    }

    // Styles for the topbar Ask AI dropdown. The Global AI Query Bar's own
    // DOM used to live here too, but its four ids (ai-query-bar/-input/
    // -btn/-result) are all absent from index.html, so its guard was
    // permanently false — the topbar Ask AI is React (NavTopbar) and
    // reaches the same engine via window._runAiQuery below. Hence both of
    // those stay and the block is gone.
    injectSmartAnalyticsStyles();
    // AE/SDR deliberately get no branch here: the global "Ask AI" bar stays
    // hidden for them (AnalyticsHub.jsx gates its Ask AI tab — Ask AI has no
    // self-scoping, unlike the analytics views' _effective_ae_sdr).


    const leadsNavLink = document.querySelector('.sidebar-nav a[data-view="leads"]');
    if (leadsNavLink) leadsNavLink.innerHTML = '<span class=\"nav-icon\"><svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/></svg></span><span class=\"nav-label\">Leads</span>';
}

// All roles: New Lead button (SDRs create leads for referrals mid-call)
if (document.getElementById('new-lead-btn')) document.getElementById('new-lead-btn').style.display = 'inline-flex';

// NOTE 2026-09-09: this block used to hide "My Settings" from Super Admins.
// Two reasons it is gone: the nav is React now (NavSidebar.jsx owns role
// visibility — every '*-nav-item' id this file still pokes at is absent from
// index.html and has been a no-op for some time), and the rule itself was
// wrong: My Settings is the only place an email signature can be set, so a
// Super Admin had no way to set one. See NavSidebar's 'my-settings' entry.

// ("Today's Calls" was gated here — NavSidebar's 'my-calls' entry owns it.)

// ── Router ────────────────────────────────────────────────────────────────────
let _skipHashUpdate = false;  // prevent recursive hashchange → loadView loop
let _analyticsLoading = false; // EC-15: guard against concurrent analytics mounts
let _calendarLoading = false;  // same double-mount guard, for CalendarHub
let _powerDialerLoading = false; // same double-mount guard, for PowerDialerHub

// Every React island keyed by the view that owns it. Drives both the
// "unmount the hubs we're leaving" sweep and the "skip showLoader() because
// this hub is still alive" check below — those were two parallel 14-clause
// if-chains, and a hub added to one but not the other is exactly how Calendar
// and User Guide ended up rendering into detached nodes (2026-08-05).
const VIEW_HUBS = {
    'dashboard':        'DashboardHub',
    'analytics':        'AnalyticsHub',
    'calendar':         'CalendarHub',
    'leads':            'LeadsHub',
    'user-guide':       'HelpHub',
    'sales-tools':      'SalesToolsHub',
    'my-calls':         'PowerDialerHub',
    'pods':             'PodsHub',
    'activity-monitor': 'ActivityMonitorHub',
    'digest':           'DailyDigestHub',
    'my-settings':      'MySettingsHub',
    'leaderboard':      'LeaderboardHub',
    'control-center':   'ControlCenterHub',
    'lead-detail':      'LeadDetailHub',
    'sdr-performance':  'SdrPerformanceHub',
    'ae-pipeline':      'AEPipelineHub',
    // 2026-09-16: CSM Portal's 4 sections promoted to their own flat nav
    // items for a CSM (see NavSidebar.jsx) — all 4 still mount the same
    // CsmPortalHub bundle/global, just with a different `section` prop.
    'csm-inbox':        'CsmPortalHub',
    'csm-portfolio':    'CsmPortalHub',
    'csm-playbooks':    'CsmPortalHub',
    'csm-digest':       'CsmPortalHub',
    // Super-Admin-only merge of AE Pipeline + CSM Portal into one nav item
    // with a tab for each (2026-09-16 product direction).
    'pipeline-hub':     'PipelineHub',
    'my-tasks':         'MyTasksHub',
};

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
    // RCA 2026-08-20: several call sites pass a lead id that can resolve to
    // JS `undefined` (e.g. a lead object that hadn't finished loading yet).
    // That used to sail straight through to a bare `#lead-detail` hash and a
    // GET /api/leads/undefined that always 404s — "Couldn't load this lead."
    // Confirmed via production logs: 50+ occurrences over the last 7 days,
    // always cascading into every lead-detail sub-tab. One guard here at the
    // shared entry point covers every current and future caller, instead of
    // hardening each click handler that could theoretically pass a bad id.
    if (viewName === 'lead-detail' && !extra) {
        // RCA 2026-08-21 (live): the original fix stopped the crash but left
        // the URL hash and content area untouched -- on a fresh boot straight
        // into a bare #lead-detail (e.g. a browser restoring a stale tab),
        // that meant a permanently blank screen with no path forward: every
        // reload, sign-out/in, or laptop restart just landed back on the same
        // hash and hit this same guard again. Redirect to the dashboard
        // instead so the hash actually changes and the user always lands
        // somewhere usable.
        console.warn('[loadView] lead-detail called with no lead id — redirecting to dashboard');
        showToast('Could not open that lead — please try again.', 'warning', 4000);
        return loadView('dashboard');
    }
    // R-3 fix: only unmount a hub when LEAVING its view. Unconditional
    // unmount() here destroyed the React root on every loadView() call —
    // including navigating back TO the same view — forcing a full remount and
    // every API call again.
    for (const [view, hub] of Object.entries(VIEW_HUBS)) {
        if (view !== viewName) window[hub]?.unmount();
    }
    // ── Alternate Messenger Widget: clear lead context when leaving a lead page ────────
    // This ensures the FAB opens in ad-hoc mode (no stale lead) on non-lead pages.
    // setLead(null, null, null) is a pure state write — safe to call any time.
    if (currentView === 'lead-detail' && viewName !== 'lead-detail') {
        if (window._messengerWidgetReady && typeof MessengerWidget !== 'undefined') {
            MessengerWidget.setLead(null, null, null);
        }
        window._currentLead = null;
        // Unmount the React Email Hub when navigating away from lead-detail so it
        // doesn't hold open polling intervals or stale references.
        window.EmailHub?.unmount();
    }

    // Re-clicking the view you're already on, while its React hub is still
    // mounted, skips showLoader(): it replaces #view-container's entire
    // innerHTML, so the hub would have to throw away a live tree and refetch
    // everything just to redraw the same screen.
    //
    // This used to be load-bearing for correctness, not just speed —
    // navigate() ignored the container it was handed and re-rendered into the
    // node mount() first attached to, so a showLoader() here left the hub
    // painting into a detached element and the skeleton on screen forever
    // (Calendar, 2026-08-05; two hubs were missing from the list). hub-entry
    // .jsx's navigate() now detects that itself, so this is an optimisation
    // with a safety net under it rather than the only thing standing between
    // a user and a blank page.
    const hubStillMounted = viewName === currentView
        && !!window[VIEW_HUBS[viewName]]?.isMounted;

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
        const leadsProps = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            apiBase:  API_BASE,
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
    } else if (viewName === 'lead-detail') {
        const navLeads = getNavLeads();
        const navIdx = navLeads.findIndex(l => l.id === extra);
        const leadDetailProps = {
            leadId:    extra,
            userRole:  currentUser?.role,
            userPodId: currentUser?.pod_id ?? null,
            apiBase:   API_BASE,
            navPosition: navIdx >= 0 ? `${navIdx + 1} / ${navLeads.length}` : null,
            onPreviousLead: navIdx > 0 ? () => loadView('lead-detail', navLeads[navIdx - 1].id, backView) : null,
            onNextLead: (navIdx >= 0 && navIdx < navLeads.length - 1) ? () => loadView('lead-detail', navLeads[navIdx + 1].id, backView) : null,
            onBack: () => loadView(backView || 'leads'),
        };

        if (window.LeadDetailHub?.isMounted && typeof window.LeadDetailHub.navigate === 'function') {
            window.LeadDetailHub.navigate(document.getElementById('lead-detail-react-root'), leadDetailProps);
            return;
        }

        if (!document.getElementById('lead-detail-react-root')) {
            vc.innerHTML = '<div id="lead-detail-react-root"></div>';
        }

        let waitedLdh = 0;
        while (!window.LeadDetailHub && waitedLdh < 5000) {
            await new Promise(r => setTimeout(r, 50));
            waitedLdh += 50;
        }
        if (!window.LeadDetailHub) {
            document.getElementById('lead-detail-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Lead Details. Please refresh.</div>';
            return;
        }

        window.LeadDetailHub.mount(document.getElementById('lead-detail-react-root'), leadDetailProps);
    } else if (viewName === 'settings' || viewName === 'admin') {
        // Retired 2026-09 alongside upload/audit-logs (same reasoning, same
        // pattern): every settings.js tab (Connection, Sync, AI, Channels,
        // Public API, Sandbox) and admin.js (Users/Roles/PODs) already has
        // full parity in Control Center (settings-architecture skill,
        // 2026-09-04/09), and neither route had a nav entry left. Kept as a
        // redirect rather than dead-ending a bookmarked/typed #settings or
        // #admin. 'assignments' was removed the same way in 2026-09-04
        // (already fully unreachable dead code; its functionality lives on
        // the main Leads page instead).
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        loadView('control-center').catch(() => {});
        return;
    } else if (viewName === 'my-settings') {
        // React My Settings island (v12.2) — replaces renderSdrSettings().
        // Open to every role: this is personal account preferences, not org
        // config, so no isAdmin gate (matches the legacy page it replaces).
        const mySettingsProps = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            apiBase:  API_BASE,
        };

        if (window.MySettingsHub?.isMounted && typeof window.MySettingsHub.navigate === 'function') {
            window.MySettingsHub.navigate(document.getElementById('my-settings-react-root'), mySettingsProps);
            return;
        }

        if (!document.getElementById('my-settings-react-root')) {
            vc.innerHTML = '<div id="my-settings-react-root"></div>';
        }

        let mySettingsWaited = 0;
        while (!window.MySettingsHub && mySettingsWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            mySettingsWaited += 50;
        }
        if (!window.MySettingsHub) {
            // Legacy renderSdrSettings() stays imported purely as this
            // crash-fallback, same pattern as Pods Hub / Activity Monitor.
            await renderSdrSettings(vc);
            return;
        }

        window.MySettingsHub.mount(document.getElementById('my-settings-react-root'), mySettingsProps);
    } else if (viewName === 'disqualify-requests') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        await renderDisqualifyRequests(vc);
    } else if (viewName === 'pods') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        // v11.5.7: PodsHub (React) replaces the classic POD Management view —
        // adds the Team Roster tab (per-rep active-lead count + staleness), the
        // capability a Pod Admin asked for ("what exactly is my SDR's work
        // going on"). Classic renderPods() kept only as the crash-fallback
        // escape hatch below, same pattern as Leads Hub's deprecation.
        const podsProps = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            apiBase:  API_BASE,
            onSwitchToClassic: () => renderPods(vc),
            // Hands off to Leads Hub pre-filtered to this rep by seeding its
            // sessionStorage view state — reuses the existing filter/fetch
            // machinery instead of building a second activity view.
            onOpenRep: (userId, name) => {
                sessionStorage.setItem('leadsHub.viewState', JSON.stringify({
                    filters: { status: [], tag: [], source: '', company: '', assignedTo: userId, outcome: '', uploadLogId: '', dateFrom: '', dateTo: '' },
                    activeFilterKeys: ['assignedTo'],
                    // Only Super Admin needs the pod-scoping bypass here — a Pod
                    // Admin's roster only ever lists their own pod's reps in the
                    // first place (GET /pods already scopes to that), so there's
                    // nothing for them to "see across pods" via this flag.
                    globalView: isSuperAdmin,
                    page: 1,
                    sort: null,
                    searchTerm: '',
                }));
                // Dispatched to the React ToastHost mounted by NavHub (always
                // present app-wide) rather than the legacy showToast() —
                // matches the polished look of the React Hub this action
                // originates from, instead of the vanilla-JS toast style.
                window.dispatchEvent(new CustomEvent('alternate:toast', {
                    detail: { message: `Showing ${name}'s leads`, type: 'info', duration: 2500 },
                }));
                loadView('leads');
            },
        };

        if (window.PodsHub?.isMounted && typeof window.PodsHub.navigate === 'function') {
            window.PodsHub.navigate(document.getElementById('pods-react-root'), podsProps);
            return;
        }

        if (!document.getElementById('pods-react-root')) {
            vc.innerHTML = '<div id="pods-react-root"></div>';
        }

        let podsWaited = 0;
        while (!window.PodsHub && podsWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            podsWaited += 50;
        }
        if (!window.PodsHub) {
            document.getElementById('pods-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load POD Management. Please refresh.</div>';
            return;
        }

        window.PodsHub.mount(document.getElementById('pods-react-root'), podsProps);
    } else if (viewName === 'leaderboard') {
        // React Leaderboard island (v12.2) — replaces renderLeaderboard().
        // roles: ['all'] in NavSidebar, so no gate here; the backend scopes
        // what each role can actually see (Pod Admin -> own pod by default).
        const leaderboardProps = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            apiBase:  API_BASE,
            // For the "You" highlight and the SDR-sees-only-own-performance rule.
            userId:   currentUser?.sub || currentUser?.id || null,
            // Name click -> that person's performance dashboard, same target
            // the legacy page's .sdr-perf-link handler used.
            onOpenPerson: (sdrId) => { if (sdrId) loadView('sdr-performance', sdrId); },
        };

        if (window.LeaderboardHub?.isMounted && typeof window.LeaderboardHub.navigate === 'function') {
            window.LeaderboardHub.navigate(document.getElementById('leaderboard-react-root'), leaderboardProps);
            return;
        }

        if (!document.getElementById('leaderboard-react-root')) {
            vc.innerHTML = '<div id="leaderboard-react-root"></div>';
        }

        let leaderboardWaited = 0;
        while (!window.LeaderboardHub && leaderboardWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            leaderboardWaited += 50;
        }
        if (!window.LeaderboardHub) {
            // Legacy renderLeaderboard() stays imported purely as this
            // crash-fallback, same pattern as My Settings / Pods Hub.
            await renderLeaderboard(vc);
            return;
        }

        window.LeaderboardHub.mount(document.getElementById('leaderboard-react-root'), leaderboardProps);
    } else if (viewName === 'sf-logs') {
        // Was: redirect to audit-logs. audit-logs is itself now a redirect
        // (see above) — point straight at the real destination rather than
        // chaining through it.
        loadView('control-center').catch(() => {});
        return;
    } else if (viewName === 'sdr-performance') {
        // React SDR Performance island (v12.2.4) — replaces
        // renderSdrPerformance(). Read-only, so no beta flag: same full
        // cutover as Dashboard/Analytics, legacy kept only as the
        // bundle-load-failure fallback (Pods/Leaderboard pattern).
        const sdrPerfProps = {
            sdrId:   extra,
            apiBase: API_BASE,
            onBack:  () => loadView('leaderboard'),
        };

        if (window.SdrPerformanceHub?.isMounted && typeof window.SdrPerformanceHub.navigate === 'function') {
            window.SdrPerformanceHub.navigate(document.getElementById('sdr-performance-react-root'), sdrPerfProps);
            return;
        }

        if (!document.getElementById('sdr-performance-react-root')) {
            vc.innerHTML = '<div id="sdr-performance-react-root"></div>';
        }

        let sdrPerfWaited = 0;
        while (!window.SdrPerformanceHub && sdrPerfWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            sdrPerfWaited += 50;
        }
        if (!window.SdrPerformanceHub) {
            // Legacy renderSdrPerformance() stays imported purely as this
            // crash-fallback, same pattern as Leaderboard / My Settings.
            await renderSdrPerformance(vc, extra, loadView);
            return;
        }

        window.SdrPerformanceHub.mount(document.getElementById('sdr-performance-react-root'), sdrPerfProps);
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
    } else if (viewName === 'sales-tools') {
        // ── Sales Tools Hub IIFE (React) ────────────────────────────────────
        // Supersedes the old standalone Sales Journey mount block — Cadence
        // is now embedded inside this hub as a tab. Mirrors the Help Hub
        // mount pattern exactly.
        const salesToolsProps = {
            userRole: currentUser?.role,
            apiBase:  API_BASE,
            journeyId: extra || null,   // #sales-tools/{journeyId} deep link
        };

        if (window.SalesToolsHub?.isMounted && typeof window.SalesToolsHub.navigate === 'function') {
            window.SalesToolsHub.navigate(document.getElementById('sales-tools-react-root'), salesToolsProps);
            return;
        }

        vc.innerHTML = '<div id="sales-tools-react-root"></div>';

        let stWaited = 0;
        while (!window.SalesToolsHub && stWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            stWaited += 50;
        }
        if (!window.SalesToolsHub) {
            document.getElementById('sales-tools-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Sales Tools. Please refresh.</div>';
            return;
        }

        window.SalesToolsHub.mount(document.getElementById('sales-tools-react-root'), salesToolsProps);
    } else if (viewName === 'upload') {
        // Retired 2026-09 alongside audit-logs (same reasoning, same
        // pattern): Control Center's Data section has full parity — every
        // legacy upload*.js endpoint has a UploadService counterpart, and
        // the port's own commit history caught two real bugs the legacy
        // page never had (services/api.js UploadService, 2026-09-02/04).
        // No nav entry pointed here already; this keeps a bookmarked/typed
        // #upload useful instead of dead.
        if (!isSuperAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        loadView('control-center').catch(() => {});
        return;
    } else if (viewName === 'audit-logs') {
        // Retired 2026-09 alongside upload (same reasoning, same pattern):
        // Control Center's Monitoring section has full parity — its own
        // comment documents "read-only parity with every tab of
        // frontend/js/views/audit_logs.js (Activity, Login History,
        // Feedback, SF Logs, Error Logs, Perf Health)". Call Logs was
        // deliberately dropped as redundant with Activity Monitor. No nav
        // entry pointed here already; this keeps a bookmarked/typed
        // #audit-logs useful instead of dead.
        if (!isSuperAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        loadView('control-center').catch(() => {});
        return;
    } else if (viewName === 'metrics' || viewName === 'activity-feed') {
        // Legacy redirects → unified Analytics Hub
        loadView('analytics').catch(() => {});
        return;
    } else if (viewName === 'analytics') {
        // AE/SDR get Analytics Hub too, forced to their own leads/calls only —
        // see backend analytics_routes._effective_ae_sdr and
        // DashboardTab.jsx's isSelfScoped (pod picker hidden, no pod-wide access).
        if (!isAdmin && !['AE', 'SDR'].includes(currentUser?.role)) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }

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
            // RCA 2026-08-19 (Clarity CLS audit): this was min-height:600px,
            // well under Analytics Hub's real ~1215px (measured live, default
            // Dashboard tab) — real content still shifted everything below it
            // down by ~615px on every load. Same technique as #dashboard-
            // react-root's reservation in style.css, just inline here since
            // this route already builds its own skeleton instead of using
            // the generic showLoader().
            vc.innerHTML = `
              <div id="analytics-react-root" style="min-height:1215px;">
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
        const dailyDigestProps = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            apiBase:  API_BASE,
        };

        if (window.DailyDigestHub?.isMounted && typeof window.DailyDigestHub.navigate === 'function') {
            window.DailyDigestHub.navigate(document.getElementById('daily-digest-react-root'), dailyDigestProps);
            return;
        }

        if (!document.getElementById('daily-digest-react-root')) {
            vc.innerHTML = '<div id="daily-digest-react-root"></div>';
        }

        let dailyDigestWaited = 0;
        while (!window.DailyDigestHub && dailyDigestWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            dailyDigestWaited += 50;
        }
        if (!window.DailyDigestHub) {
            document.getElementById('daily-digest-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Team Digest. Please refresh.</div>';
            return;
        }

        window.DailyDigestHub.mount(document.getElementById('daily-digest-react-root'), dailyDigestProps);
    } else if (viewName === 'my-tasks') {
        // No role/admin gate — every authenticated user can have tasks
        // assigned to them (GET /api/my/tasks scopes server-side by user_id).
        const myTasksProps = {
            token:    localStorage.getItem('crm_token'),
            apiBase:  API_BASE,
            onLeadClick: (id) => loadView('lead-detail', id, 'my-tasks'),
            // v13.7.0: the bell's approvals open straight on that tab.
            initialTab: extra || undefined,
            navAt:      Date.now(),
        };

        if (window.MyTasksHub?.isMounted && typeof window.MyTasksHub.navigate === 'function') {
            window.MyTasksHub.navigate(document.getElementById('my-tasks-react-root'), myTasksProps);
            return;
        }

        if (!document.getElementById('my-tasks-react-root')) {
            vc.innerHTML = '<div id="my-tasks-react-root"></div>';
        }

        let myTasksWaited = 0;
        while (!window.MyTasksHub && myTasksWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            myTasksWaited += 50;
        }
        if (!window.MyTasksHub) {
            document.getElementById('my-tasks-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load My Tasks. Please refresh.</div>';
            return;
        }

        window.MyTasksHub.mount(document.getElementById('my-tasks-react-root'), myTasksProps);
    } else if (viewName === 'activity-monitor') {
        if (!isAdmin) { vc.innerHTML = `<div style="padding:60px;text-align:center;"><h2>🚫 Access Denied</h2></div>`; return; }
        // Activity Monitor (React) replaces the classic Call Monitor view —
        // adds Email/Message tabs alongside Calls, same page. Classic
        // renderCallMonitor() kept only as the crash-fallback escape hatch,
        // same pattern as Pods Hub's deprecation.
        const activityMonitorProps = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            apiBase:  API_BASE,
            onSwitchToClassic: () => renderCallMonitor(vc),
            onOpenLead: (leadId) => loadView('lead-detail', leadId),
        };

        if (window.ActivityMonitorHub?.isMounted && typeof window.ActivityMonitorHub.navigate === 'function') {
            window.ActivityMonitorHub.navigate(document.getElementById('activity-monitor-react-root'), activityMonitorProps);
            return;
        }

        if (!document.getElementById('activity-monitor-react-root')) {
            vc.innerHTML = '<div id="activity-monitor-react-root"></div>';
        }

        let activityMonitorWaited = 0;
        while (!window.ActivityMonitorHub && activityMonitorWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            activityMonitorWaited += 50;
        }
        if (!window.ActivityMonitorHub) {
            document.getElementById('activity-monitor-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Activity Monitor. Please refresh.</div>';
            return;
        }

        window.ActivityMonitorHub.mount(document.getElementById('activity-monitor-react-root'), activityMonitorProps);
    } else if (viewName === 'control-center') {
        // 2026-09-04: widened from single-owner-email to all Super Admins.
        // 2026-09-09 (v12.2): Pod Admin admitted too, but the sections are now
        // individually role-gated (frontend-react/.../control-center/
        // constants.js SECTION_TABS[].roles) so a Pod Admin sees only Team &
        // Access — the one section they already hold in legacy (admin.js
        // "Team Management"). Integrations / AI & Automation / Data /
        // Monitoring stay Super-Admin-only, which is what previously made
        // opening this page to Pod Admin an over-grant.
        // Typing #control-center must still do nothing for every other role.
        if (!['Super Admin', 'Pod Admin'].includes(currentUser?.role || '')) {
            loadView('dashboard');
            return;
        }
        const controlCenterProps = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            apiBase:  API_BASE,
        };

        if (window.ControlCenterHub?.isMounted && typeof window.ControlCenterHub.navigate === 'function') {
            window.ControlCenterHub.navigate(document.getElementById('control-center-react-root'), controlCenterProps);
            return;
        }

        if (!document.getElementById('control-center-react-root')) {
            vc.innerHTML = '<div id="control-center-react-root"></div>';
        }

        let controlCenterWaited = 0;
        while (!window.ControlCenterHub && controlCenterWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            controlCenterWaited += 50;
        }
        if (!window.ControlCenterHub) {
            document.getElementById('control-center-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Control Center. Please refresh.</div>';
            return;
        }

        window.ControlCenterHub.mount(document.getElementById('control-center-react-root'), controlCenterProps);
    } else if (viewName === 'ae-pipeline') {
        // Phase 1: AE Pipeline. Own-data view for AE; Pod Admin gets the same
        // oversight extension the AE leaderboard already gives them. SDR
        // excluded — also enforced server-side in ae_pipeline_routes.py.
        // Super Admin excluded here (2026-09-16): they now reach this same
        // view — plus CSM Portal — through the merged 'pipeline-hub' route
        // below, one nav item with a tab each, instead of two separate ones.
        if (!['AE', 'Pod Admin', 'Admin'].includes(currentUser?.role || '')) {
            loadView('dashboard');
            return;
        }
        const aePipelineProps = {
            token:    localStorage.getItem('crm_token'),
            userRole: currentUser?.role,
            apiBase:  API_BASE,
        };

        if (window.AEPipelineHub?.isMounted && typeof window.AEPipelineHub.navigate === 'function') {
            window.AEPipelineHub.navigate(document.getElementById('ae-pipeline-react-root'), aePipelineProps);
            return;
        }

        if (!document.getElementById('ae-pipeline-react-root')) {
            vc.innerHTML = '<div id="ae-pipeline-react-root"></div>';
        }

        let aePipelineWaited = 0;
        while (!window.AEPipelineHub && aePipelineWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            aePipelineWaited += 50;
        }
        if (!window.AEPipelineHub) {
            document.getElementById('ae-pipeline-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load AE Pipeline. Please refresh.</div>';
            return;
        }

        window.AEPipelineHub.mount(document.getElementById('ae-pipeline-react-root'), aePipelineProps);
    } else if (['csm-inbox', 'csm-portfolio', 'csm-playbooks', 'csm-digest'].includes(viewName)) {
        // Phase 2: CSM Portal Beta, CSM's own view. 2026-09-16: promoted from
        // one 'csm-portal' item with an internal tab strip to 4 flat
        // top-level nav items — "all the tabs should come outside... a view
        // which greets them" — so each of these routes mounts the same
        // CsmPortalHub bundle, just pinned to one section (see
        // CsmPortalHub.jsx's `section` prop) with no internal tab strip.
        // Super Admin oversight moved to the merged 'pipeline-hub' route.
        if (!['CSM'].includes(currentUser?.role || '')) {
            loadView('dashboard');
            return;
        }
        const section = viewName.slice('csm-'.length); // inbox | portfolio | playbooks | digest
        const csmPortalProps = {
            token:           localStorage.getItem('crm_token'),
            userRole:        currentUser?.role,
            userName:        currentUser?.name || currentUser?.email || '',
            apiBase:         API_BASE,
            section,
            // Deep-link from the global search's Accounts group straight
            // into that account's detail, instead of just the section list.
            initialAccountId: extra || null,
        };

        if (window.CsmPortalHub?.isMounted && typeof window.CsmPortalHub.navigate === 'function') {
            window.CsmPortalHub.navigate(document.getElementById('csm-portal-react-root'), csmPortalProps);
            return;
        }

        if (!document.getElementById('csm-portal-react-root')) {
            vc.innerHTML = '<div id="csm-portal-react-root"></div>';
        }

        let csmPortalWaited = 0;
        while (!window.CsmPortalHub && csmPortalWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            csmPortalWaited += 50;
        }
        if (!window.CsmPortalHub) {
            document.getElementById('csm-portal-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load CSM Portal. Please refresh.</div>';
            return;
        }

        window.CsmPortalHub.mount(document.getElementById('csm-portal-react-root'), csmPortalProps);
    } else if (viewName === 'pipeline-hub') {
        // 2026-09-16: Super-Admin-only merge of AE Pipeline + CSM Portal
        // into one nav item with a tab for each ("the both the items should
        // be merged as they have a tab for themselves") — a third bundle
        // (features/pipeline-hub/PipelineHub.jsx) that imports both
        // islands' real components directly, rather than two separate nav
        // entries pointing at the same content.
        if (!['Super Admin'].includes(currentUser?.role || '')) {
            loadView('dashboard');
            return;
        }
        const pipelineHubProps = {
            token:            localStorage.getItem('crm_token'),
            userRole:         currentUser?.role,
            apiBase:          API_BASE,
            initialAccountId: extra || null,
        };

        if (window.PipelineHub?.isMounted && typeof window.PipelineHub.navigate === 'function') {
            window.PipelineHub.navigate(document.getElementById('pipeline-hub-react-root'), pipelineHubProps);
            return;
        }

        if (!document.getElementById('pipeline-hub-react-root')) {
            vc.innerHTML = '<div id="pipeline-hub-react-root"></div>';
        }

        let pipelineHubWaited = 0;
        while (!window.PipelineHub && pipelineHubWaited < 5000) {
            await new Promise(r => setTimeout(r, 50));
            pipelineHubWaited += 50;
        }
        if (!window.PipelineHub) {
            document.getElementById('pipeline-hub-react-root').innerHTML =
              '<div style="padding:60px;text-align:center;color:#DC2626;">⚠️ Failed to load Pipeline. Please refresh.</div>';
            return;
        }

        window.PipelineHub.mount(document.getElementById('pipeline-hub-react-root'), pipelineHubProps);
    } else if (viewName === 'playground') {
        // Deprecated per product direction: redirect to control-center
        loadView('control-center').catch(() => {});
        return;
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

// ── Upload Leads: now handled by Control Center's Data section (React) ───────

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

// Same bridge, for the reply-notification section of the same bell.
window._fetchPendingReplies = fetchPendingReplies;
window._dismissReply = dismissReply;

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
window._openNoShowModal = openNoShowModal;
window._openDemoFailedModal = openDemoFailedModal;
window._runLeadStageAction = runLeadStageAction;
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
    // XState machine. For Alternate Messenger SDRs, DialerMachine may be stuck in AWAITING_MODE
    // or INITIATING from a previous failed attempt — this causes isWidgetActive()=true
    // and silently blocks every call attempt (no _callInFlight set, no backend call).
    // FIX: gate each provider on its own state machine only.
    const _provider = (_dialerConfig.provider || '').toLowerCase();
    const _isAlternateMessenger = window.AlternateMessengerDialer?.isActive?.() ?? false;
    // For Aircall: check DialerMachine. For Alternate Messenger: ignore DialerMachine entirely.
    const _isAircallActive = _provider !== 'messenger' && isWidgetActive();

    // Auto-heal: if DialerMachine is stuck in non-IDLE state for a Alternate Messenger SDR,
    // reset it so it never blocks future Aircall calls either (if provider switches).
    if (_provider === 'messenger' && isWidgetActive()) {
        console.warn('[handleCallAction] DialerMachine stuck in non-IDLE for Alternate Messenger SDR — auto-resetting');
        if (window.DialerMachine) window.DialerMachine.send('RESET');
    }

    if (_isAircallActive || _isAlternateMessenger) {
        // RCA 2026-08-19 (Aditya, Slack): this gate used to be a dead end — if
        // DialerMachine/AlternateMessenger got stuck non-IDLE (client glitch) or a
        // real ghost call sat in the DB, the SDR saw this toast forever, with no
        // way to reach the EC-16 self-heal that already exists for calls that
        // fail AFTER reaching the backend (see the catch block below). Hard
        // refresh/relogin doesn't help because a genuinely-active DB row keeps
        // reporting itself active regardless of client state. Check backend
        // truth before blocking, same as that later path already does.
        try {
            const activeData = await getMyActiveCall();
            if (!activeData?.active) {
                console.warn('[handleCallAction] Client showed active call but backend disagrees (stale/healed) — auto-resetting');
                if (window.DialerMachine) window.DialerMachine.send('RESET');
                try { window.AlternateMessengerDialer?.destroy?.(); } catch { /* ignore */ }
            } else {
                _showForceClearBanner(activeData);
                return;
            }
        } catch {
            showToast('📞 A call is already in progress. End the current call first.', 'warning', 4000);
            return;
        }
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

        // ── Alternate Messenger: open the MessengerWidget Call tab for mode selection ────
        // The widget renders "Phone Bridge / Browser Call" buttons inside its own
        // Call tab pane, returning the chosen mode via a Promise.
        // Aircall routes directly to startDialerCall() — no mode selection needed.
        // (V48: Aircall Everywhere doesn't need a branch here either — an SDR logged
        // into the embedded workspace instead of the Desktop app is just another
        // device Aircall's existing click-to-dial REST call already rings. See
        // useAircallEverywhere.js's docblock.)
        let callMode = 'bridge'; // default for Aircall
        if (provider === 'messenger') {
            // RCA 2026-07-22: this promise only resolves when the SDR clicks a mode
            // button inside the widget panel. If the panel fails to mount/render for
            // any reason, the promise hangs forever with no error — _callInFlight
            // stayed stuck `true` permanently, silently blocking every future call
            // attempt until a hard refresh. Guarded with a try/catch (was previously
            // outside any try/catch entirely) and a timeout so this can never brick
            // the call button again, regardless of the underlying widget glitch.
            try {
                const modeSelection = (!_messengerWidgetReady || typeof MessengerWidget === 'undefined')
                    // Widget not initialised (no credentials / wrong provider) — fall back
                    ? _showCallModeSelector(leadName, phone)
                    : MessengerWidget.openForCall({ leadId, leadName, phone });
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

        // For Alternate Messenger: set INITIATING state before the API call so _syncCallPane()
        // in messenger_widget.js doesn't reset the "Connecting..." spinner to idle
        // during the async gap between mode selection and activate().
        if (provider === 'messenger') {
            window.AlternateMessengerDialer.setInitiating();
        }

        try {
            const result = await startDialerCall(leadId, phone, callMode);


            // Activate AlternateMessenger for Alternate Messenger calls — replaces showDialerWidget()
            if (result.provider === 'messenger') {
                // AlternateMessenger owns state, fires alternate:call-started (renders panel)
                // and alternate:call-ended (opens outcome modal). No machine dependency.
                await window.AlternateMessengerDialer.activate(result, leadName, phone, callMode);
                window._callInFlight = false;
                return;
            } else {
                // Aircall: initiate in the Aircall phone app.
                // RCA 2026-08-17 (LIVE): getCallStatus() polls GET /calls/{callId}/status,
                // which is keyed on our own DB call_id — always present regardless of
                // whether Aircall's REST response for POST /users/{id}/calls carried a
                // provider_call_id synchronously (a bridge-mode dial often doesn't get
                // one until the agent's IVR leg connects). Gating polling on
                // provider_call_id meant that window — which can span most of a bridge
                // call's early lifetime — fell through to a banner claiming "Call ended"
                // the instant the call was merely dialed, while Aircall's own panel
                // still showed "Ringing…". Poll on callId alone; it's always present.
                const callId = result.call_id;  // our DB UUID — always present

                if (callId && window._startAircallOutcomePolling) {
                    window._startAircallOutcomePolling(callId, leadId, leadName, phone);
                    showToast(`✅ Aircall initiated. The outcome form will open automatically when the call ends.`, 'success', 5000);
                    window._callInFlight = false;
                    return;
                } else {
                    // No callId at all (should not happen — initiate_call() always
                    // creates the DialerCall row first) — can't poll or attach an
                    // outcome. Prompt for a manual log without claiming the call ended.
                    _setPendingOutcome({ leadId, leadName, phone, callId });
                    showToast(`📞 Aircall initiated. Please log the outcome below.`, 'info', 4000);
                    openCallModal(leadId, leadName, phone, lead, callId, _dialerConfig.provider || null);
                    window._callInFlight = false;
                    return;
                }
            }
        } catch (err) {
            // Dialer call failed (e.g. Aircall 405 — user offline/unavailable, or
            // Alternate Messenger API error). Show the error toast but do NOT open the outcome
            // modal — the call never connected, so there is nothing to log.
            window._callInFlight = false;

            // For Alternate Messenger: reset the dialer state machine (INITIATING → IDLE)
            // so the next call attempt is not blocked by a stale INITIATING state.
            if ((_dialerConfig.provider || '').toLowerCase() === 'messenger') {
                try { window.AlternateMessengerDialer?.destroy?.(); } catch { /* ignore */ }
                // Revert widget from "Connecting..." back to lead idle view.
                if (typeof MessengerWidget !== 'undefined') {
                    MessengerWidget.notifyCallFailed(err.message);
                }
            }

            // Ghost call auto-heal: if the error is "active call in progress",
            // hit GET /api/calls/my-active which applies EC-16 staleness thresholds
            // and auto-heals stale CALL_STARTED records (e.g. missed Alternate Messenger webhook).
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
 * This happens when AlternateMessenger.hangup() got a 502 from /calls/disconnect,
 * silently caught it, and reset the local state to IDLE — leaving the DB stuck.
 * The SDR now has a one-click escape instead of waiting 15 minutes (new EC-16 threshold).
 */
function _showForceClearBanner(activeCallData) {
    const _FORCE_CLEAR_ID = 'force-clear-call-banner';
    unstackTopBanner(document.getElementById(_FORCE_CLEAR_ID));

    // RCA 2026-08-19: was a plain (non-fixed) outer div wrapping an inner
    // position:fixed div — a fixed-position child is taken out of normal
    // flow, so the outer div's own box collapsed to 0 height and never
    // pushed page content down at all, unconditionally covering whatever
    // topbar controls sat underneath it (a real Clarity dead-click cause).
    // stackTopBanner needs the element it positions to be the actual
    // banner box, so the fixed styling now lives directly on it.
    const banner = document.createElement('div');
    banner.id = _FORCE_CLEAR_ID;
    banner.style.cssText = 'z-index:10000;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;padding:11px 20px;display:flex;align-items:center;justify-content:space-between;font-size:0.84rem;font-weight:600;box-shadow:0 4px 20px rgba(124,58,237,0.4);animation:slideDown 0.3s ease;gap:12px;';
    banner.innerHTML = `
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
    `;
    stackTopBanner(banner);

    // Dismiss
    document.getElementById('force-clear-dismiss')?.addEventListener('click', () => {
        unstackTopBanner(banner);
    });

    // Force clear
    document.getElementById('force-clear-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('force-clear-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Clearing…'; }
        try {
            if (activeCallData?.call_id) {
                await forceEndCall(activeCallData.call_id);
            }
            // Also reset local AlternateMessenger state in case it's in a partial state
            try { window.AlternateMessengerDialer?.destroy?.(); } catch { /* ignore */ }
            unstackTopBanner(banner);
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
// v11.10.0: what this user may actually do (calling / SMS / WhatsApp), resolved
// server-side. Fetched alongside dialer status rather than derived from it —
// messaging used to be inferred from the *dialer* provider, which is why an SDR
// on Aircall for calling could never message. Never rejects: a failure here
// must not block page boot, so it resolves to null and the widget falls back to
// the dialer-only behaviour.
let _capabilities = null;
const _capabilitiesPromise = getMyCapabilities()
    .then(caps => {
        _capabilities = caps;
        // The React islands read this to decide whether to show Export buttons (src/lib/useCanExport.js).
        window.__CRM_CAPS__ = caps;
        window.dispatchEvent(new CustomEvent('alternate:caps', { detail: caps }));
        return caps;
    })
    .catch(err => { console.warn('[Capabilities] load failed:', err.message); return null; });

// Fetch dialer config at startup (store promise to await later)
const _dialerConfigPromise = fetchDialerStatus().then(conf => {
    _dialerConfig = conf;
    window._dialerConfig = conf;

    // v11.3.0: Caller-ID — watch for inbound calls even when no widget is
    // open yet (see dialer_widget.js's initIncomingCallWatcher docblock).
    if (conf.active && conf.has_credentials && conf.provider !== 'none') {
        initIncomingCallWatcher();
    }

    // BUG-04: Show manual dial button if dialer is active
    const manualDialBtn = document.getElementById('manual-dial-btn');
    if (manualDialBtn && conf.active && conf.has_credentials && conf.provider !== 'none') {
        const _accentColor = (conf.provider || '').toLowerCase() === 'aircall' ? '#00b388' : '#4f46e5';
        manualDialBtn.style.display = 'inline-flex';
        manualDialBtn.style.background = _accentColor;
        manualDialBtn.style.borderColor = _accentColor;
        manualDialBtn.addEventListener('click', () => {
            // v6.2.0: Route all manual dial through showManualDialWidget().
            // For Alternate Messenger, that function calls MessengerWidget.openForManualDial()
            // internally AND attaches the .then() handler that POSTs /api/calls/start.
            // Calling openForManualDial() directly here dropped the Promise result,
            // so the call never went through our backend — calls/start was never hit.
            showManualDialWidget();
        });

    }

    return conf;
}).catch(() => {});

initModals(loadView, () => currentView, () => []);

// ── Alternate Messenger Messaging Widget ───────────────────────────────────────────────
// Initialize the floating WhatsApp/SMS widget if Alternate Messenger messaging is enabled.
// MessengerWidget is a UMD global loaded via <script src="js/messenger_widget.js">.
// GUARD (v11.10.0): the widget mounts when the user holds *any* live
// capability, and each tab gates on its own. The Call tab stays Alternate Messenger-only
// because the Alternate Messenger SDK's floating button conflicts with the Aircall call
// flow (Monisha bug: widget FAB visible even when provider override = aircall),
// but an Aircall caller who holds SMS/WhatsApp now gets the Message tab — the
// old rule skipped the whole widget for them, making Alternate Messenger messaging
// unreachable no matter how it was configured.
// RCA 2026-08-24 (live, prod): this whole decision used to be one shot —
// a transient /api/dialer/status hiccup left _messengerWidgetReady false
// for the rest of the session with only a console.warn, while the call
// engine (dialerEngine.js) still ran the call for real: audio worked, but
// no timer/mute/hangup ever appeared. _tryInitMessengerWidget() returns
// whether the attempt was a *trustworthy* outcome (init succeeded, or the
// SDR is genuinely on Aircall/no dialer) vs one that should be retried
// (the status fetch itself failed, or the widget script wasn't ready yet).
async function _tryInitMessengerWidget(dialerConfigPromise, capabilitiesPromise) {
    let _resolvedProvider = 'none';
    let _statusFetchFailed = false;
    try {
        const _ds = await dialerConfigPromise;
        _resolvedProvider = (_ds?.provider || 'none').toLowerCase();
        // Keep the module-level config in sync — the retry path fetches fresh
        // status independent of the startup `_dialerConfigPromise`, and the
        // `if` below reads `_dialerConfig.has_credentials`, not `_ds` directly.
        if (_ds) { _dialerConfig = _ds; window._dialerConfig = _ds; }
    } catch { _statusFetchFailed = true; }

    // Taken as a parameter, not read from the module-level promise, so the
    // retry below genuinely re-fetches instead of re-reading a failed result.
    const _caps = await capabilitiesPromise;
    if (_caps) _capabilities = _caps;

    const _messengerUser = _resolvedProvider === 'messenger';

    // v11.10.0: the widget hosts two independent things — a Alternate Messenger Call tab
    // and a Message tab. Gating the whole widget on the *dialer* provider (the
    // old rule) meant Alternate Messenger messaging was unreachable for anyone calling on
    // Aircall, and that granting the dialer silently granted WhatsApp. Each tab
    // now gates on its own capability.
    //
    // The Call tab stays Alternate Messenger-only: the Alternate Messenger SDK's call flow
    // conflicts with Aircall's, which is the original reason for the Aircall
    // skip (Monisha bug: widget FAB visible even when provider override =
    // aircall). Aircall users still get the Message tab if they hold a channel.
    const _canCall = _messengerUser && _dialerConfig.has_credentials
                     && (_caps ? _caps.calling?.enabled !== false : true);
    const _canMessage = !!_caps && (_caps.sms?.ready || _caps.whatsapp?.ready);

    if (_canCall || _canMessage) {
        if (typeof MessengerWidget !== 'undefined') {
            MessengerWidget.init({
                apiBase:  API_BASE,
                senderId: _dialerConfig.sender_id || '',
                theme:    'dark',   // dark glassmorphism — light theme CSS incomplete (white-on-white)
                // Which tabs to render. The widget must not offer a channel the
                // API will reject, so these come straight from the server's
                // capability resolution rather than being re-derived here.
                capabilities: {
                    call:     _canCall,
                    sms:      !!_caps?.sms?.ready,
                    whatsapp: !!_caps?.whatsapp?.ready,
                },
            });
            _messengerWidgetReady = true;
            window._messengerWidgetReady = true;

            // ── Bridge window.alternatecrmDialer → AlternateMessenger ────────────────────
            // messenger_widget.js uses window.alternatecrmDialer.isActive() in its
            // _activeSyncTimer safety net (line ~1239). Without this bridge, the timer
            // always sees isActive()=undefined, waits 10 s, then calls _renderCallIdle()
            // → "Ready to call" appears mid-call AND _pendingModeResolve is cleared,
            // blocking every subsequent call attempt in the same session.
            window.alternatecrmDialer = window.AlternateMessengerDialer;

            console.info('[MessengerWidget] Initialised — call:%s sms:%s whatsapp:%s',
                _canCall, !!_caps?.sms?.ready, !!_caps?.whatsapp?.ready);

            // ── T4D: Caller ID startup warning ─────────────────────────────────────
            // If the SDR has no personal caller ID AND the global from_number is not
            // set, leads will see a Alternate Messenger default number. Warn once per session.
            // Only relevant when the Call tab is actually live — a messaging-only
            // user has no caller ID to set and shouldn't be told to set one.
            if (_canCall && !_dialerConfig.from_number && !sessionStorage.getItem('_cwCallerIdWarnShown')) {
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
            if (_canCall) {
                getMyActiveCall().then(activeCallData => {
                    if (activeCallData?.active && !window.AlternateMessengerDialer?.isActive?.()) {
                        console.info('[App] Recovering mid-call state from DB:', activeCallData.call_id);
                        window.AlternateMessengerDialer?.recoverFromActiveCall?.(activeCallData);
                    }
                }).catch(() => {}); // non-fatal — page loads normally
            }

            // NOTE (SS1 revisited): The original SS1 fix tried to suppress a
            // "third-party Alternate Messenger SDK FAB", but MessengerWidget is our own
            // custom component — #messenger-widget-root and .cw-fab are OUR
            // elements. Suppressing them hides the entire widget. Removed.
            return true;
        }
        return false; // widget script not ready yet — worth a retry
    }
    console.info('[MessengerWidget] Init skipped — no live capability (dialer provider: %s)', _resolvedProvider);
    // "nothing enabled" is only a trustworthy answer if both fetches actually
    // succeeded; otherwise the retry path should have another go.
    return !_statusFetchFailed && !!_caps;
}

try {
    let _ready = await _tryInitMessengerWidget(_dialerConfigPromise, _capabilitiesPromise);
    if (!_ready) {
        await new Promise(r => setTimeout(r, 3000));
        _ready = await _tryInitMessengerWidget(
            fetchDialerStatus(),
            getMyCapabilities().catch(() => null),
        );
    }
    if (!_ready) {
        showToast('⚠️ Call/message widget failed to load — refresh the page before calling or messaging', 'warning', 8000);
    }
} catch (_e) { console.warn('[MessengerWidget] Init skipped:', _e.message); }

// ── Dialer Outcome Gate ────────────────────────────────────────────────────────
// Ensures SDRs always log an outcome after a dialer-assisted call.
// Works across page refreshes via localStorage persistence.

const _OUTCOME_KEY  = 'ls_pending_outcome';  // localStorage key
const _BANNER_ID    = 'outcome-gate-banner';
let   _aircallPollInterval = null;
let   _aircallSSE = null;

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
    // RCA 2026-08-19: see _showForceClearBanner's comment — same bug shape
    // (fixed styling on a detached inner div instead of the banner itself),
    // same fix (flatten it, route through the shared stacking helper).
    const banner = document.createElement('div');
    banner.id = _BANNER_ID;
    banner.style.cssText = 'z-index:9999;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;font-size:0.85rem;font-weight:600;box-shadow:0 4px 20px rgba(220,38,38,0.4);animation:slideDown 0.3s ease;';
    banner.innerHTML = `
            <span>📞 Call ended — please log the outcome for <strong>${_escHtml(pending.leadName)}</strong></span>
            <button id="outcome-banner-log-btn" style="
                padding:6px 16px;border-radius:8px;border:none;
                background:rgba(255,255,255,0.15);color:#fff;
                cursor:pointer;font-size:0.82rem;font-weight:700;
                margin-left:16px;flex-shrink:0;
            ">Log Outcome</button>
    `;
    stackTopBanner(banner);
    document.getElementById('outcome-banner-log-btn')?.addEventListener('click', () => {
        _openPendingOutcomeModal();
    });
}

function _removeStickyBanner() {
    unstackTopBanner(document.getElementById(_BANNER_ID));
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
    window.dispatchEvent(new CustomEvent('alternate:call-outcome-resolved',
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
 * Fired whenever a dialer call ends (Alternate Messenger widget event or Aircall poll).
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
function _stopAircallOutcomeWatch() {
    if (_aircallPollInterval) { clearInterval(_aircallPollInterval); _aircallPollInterval = null; }
    if (_aircallSSE) { _aircallSSE.close(); _aircallSSE = null; }
}

// Terminal statuses from aircall_provider.py webhook mapping
const _AIRCALL_TERMINAL = new Set(['ended', 'done', 'CALL_ENDED', 'disconnected', 'missed',
                                    'failed', 'cancelled', 'busy', 'unanswered', 'CALL_MISSED']);

function _startAircallOutcomePolling(callId, leadId, leadName, phone) {
    const MAX_POLLS = 60;  // 60 × 10 s = 10 min timeout
    let polls = 0;
    let resolved = false;

    _stopAircallOutcomeWatch();

    const resolve = () => {
        if (resolved) return;  // SSE and the poll can both fire — only act once
        resolved = true;
        _stopAircallOutcomeWatch();
        _onDialerCallEnded(leadId, leadName, phone, callId);
    };

    // Fast path: the backend already publishes this call's CALL_STATUS to the
    // SSE broker on every webhook (dialer_routes.py::_publish_call_status).
    // RCA 2026-08-20: nothing on the frontend ever subscribed for Aircall
    // calls, so this event was always going into the void and every call
    // fell through to the 10s poll below — a real, consistent 10-20s delay
    // before the outcome modal opened. Same EventSource + query-string-token
    // pattern dialer_widget.js already uses for incoming calls.
    //
    // RCA 2026-08-21 (LIVE, prod): live timestamped tracing showed this path
    // itself resolves ~2ms after receiving a terminal event — the real
    // remaining 10-30s "delay" reported live was entirely upstream, in
    // aircall_provider.py's webhook event mapping (call.hungup, sent by
    // Aircall the instant the line disconnects, was unmapped and discarded;
    // only call.ended — which this org's Aircall account sends ~30s later —
    // was acted on). Fixed there; nothing to change here.
    const token = getAuthToken();
    if (token && window.EventSource) {
        try {
            const es = new EventSource(`${API_BASE}/api/calls/events?token=${encodeURIComponent(token)}`);
            _aircallSSE = es;
            es.onmessage = (ev) => {
                try {
                    const data = JSON.parse(ev.data);
                    if (data.call_id === callId && (data.type === 'CALL_ENDED' || _AIRCALL_TERMINAL.has(data.status))) resolve();
                } catch { /* ignore malformed/keepalive event */ }
            };
            // RCA 2026-08-21 (LIVE, prod): unconditionally closing here on every
            // `error` event killed this connection's OWN native auto-reconnect —
            // EventSource retries transient drops by itself (readyState goes back
            // to CONNECTING, not CLOSED), but calling close() ourselves cancels
            // that and permanently falls back to the 10s poll for the rest of the
            // call. Render/Cloudflare's infra reliably drops a long-lived SSE
            // connection at least once over a 15-55s call, so this "fast path"
            // (RCA 2026-08-20 above) never actually stayed fast — only give up
            // once the browser itself has (readyState CLOSED); otherwise let it
            // keep retrying on its own.
            es.onerror = () => {
                if (es.readyState === EventSource.CLOSED && _aircallSSE === es) _aircallSSE = null;
            };
        } catch { /* EventSource unavailable — poll below covers it */ }
    }

    // Safety net: still polls even if SSE never connects/fires, and is the
    // sole path when EventSource isn't available at all.
    _aircallPollInterval = setInterval(async () => {
        polls++;
        if (polls > MAX_POLLS) { resolve(); return; }  // timeout: open modal anyway so SDR isn't stuck
        try {
            const data = await getCallStatus(callId);
            // Terminal if: status string matches, OR ended_at is set (webhook fired)
            if (_AIRCALL_TERMINAL.has(data?.status) || !!data?.ended_at) resolve();
        } catch { /* polling errors are non-fatal */ }
    }, 10_000);
}

// ── Wire up the 'call-ended' CustomEvent from the dialer widget ───────────────
// The widget fires window.dispatchEvent(new CustomEvent('alternate:call-ended', { detail: ... }))
// whenever a Alternate Messenger call ends (via status poll or manual hangup).
window.addEventListener('alternate:call-ended', (ev) => {
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
        
        // Hide the widget only when it has nothing to offer: no Alternate Messenger
        // calling AND no messaging. v13.7.0: it used to hide on any non-
        // Alternate Messenger dialer, so an Aircall rep's "Message" opened an invisible
        // panel — the same rule init uses (_tryInitMessengerWidget).
        const _canMessageHere = !!(_capabilities?.sms?.ready || _capabilities?.whatsapp?.ready);
        if ((!conf.active || conf.provider !== 'messenger') && !_canMessageHere) {
            const fab = document.querySelector('.cw-fab');
            if (fab) fab.style.display = 'none';
            const widgetRoot = document.getElementById('messenger-widget-root');
            if (widgetRoot) widgetRoot.style.display = 'none';
        } else {
            const fab = document.querySelector('.cw-fab');
            if (fab) fab.style.display = 'flex';
            const widgetRoot = document.getElementById('messenger-widget-root');
            if (widgetRoot) widgetRoot.style.display = 'block';
        }
    } catch (e) {
        console.error('Failed to refresh dialer config:', e);
    }
}

// Global hook for lead_detail.js to open the messaging widget for a specific lead.
// Guard uses _messengerWidgetReady — NOT typeof MessengerWidget, which is always defined
// because the UMD script is always loaded regardless of whether init() ran.
window._openMessagingWidget = (leadId, leadName, phone, lead = {}) => {
    // v11.10.0: name the actual reason. "not available for your account
    // configuration" sent every SDR to their admin with nothing to act on;
    // the server already resolves why a channel isn't live, so say it.
    const _sms = _capabilities?.sms, _wa = _capabilities?.whatsapp;
    if (!_sms?.enabled && !_wa?.enabled) {
        showToast('Messaging is not enabled for your account. Ask your admin to grant SMS or WhatsApp.', 'warning', 6000);
        return;
    }
    if (!_messengerWidgetReady) {
        showToast(_sms?.reason || _wa?.reason || 'Messaging is unavailable right now — try refreshing.', 'warning', 7000);
        return;
    }
    MessengerWidget.openForLead({ leadId, leadName, phone, lead });
};

// Whether to render the 💬 Message affordance at all — read by lead_detail.js.
// A button that always shows and then explains it can't work is worse than no
// button; an SDR without the channel simply doesn't see one.
window._canMessageLeads = () => !!(_capabilities?.sms?.enabled || _capabilities?.whatsapp?.enabled);

// Parse hash to restore view on page refresh / initial load
function _parseHash() {
    const raw = location.hash.replace(/^#/, '');
    // CSM lands on their Inbox — the "what needs you today" queue, not the
    // SDR/AE-shaped Dashboard (My Leads, Calling, Meetings Booked,
    // leaderboard — none of it applies to a CSM's account-portfolio work;
    // NavSidebar.jsx also hides both of those nav items from CSM for the
    // same reason). 2026-09-16: was 'csm-portal' (one wrapper page); Inbox
    // is now its own flat nav item and the natural landing section.
    if (!raw) return { view: currentUser?.role === 'CSM' ? 'csm-inbox' : 'dashboard', extra: null };
    // Easter-egg unlock for Pipeline & CSM Portal (see NavSidebar.jsx
    // MOGAMBO_KEY) — those nav items are hidden from everyone while that
    // surface is reworked; typing #mogambo once per browser session reveals
    // them again, but only for this one account (NavSidebar re-checks the
    // email itself, this isn't the only gate). Not a real view, so fall
    // through to the default landing view instead of trying to mount a
    // "mogambo" hub.
    if (raw.toLowerCase() === 'mogambo') {
        let justUnlocked = false;
        if ((currentUser?.email || '').trim().toLowerCase() === 'neelmani.mishra@screen-magic.com') {
            try { sessionStorage.setItem('alternate:mogambo-unlocked', '1'); justUnlocked = true; } catch {}
        }
        return { view: currentUser?.role === 'CSM' ? 'csm-inbox' : 'dashboard', extra: null, justUnlocked };
    }
    const parts = raw.split('/');
    return { view: parts[0], extra: parts.slice(1).join('/') || null };
}

// Listen for back/forward navigation
window.addEventListener('hashchange', () => {
    // EC-15b: skip if this hashchange was triggered by loadView itself setting the hash
    if (_skipHashUpdate) return;
    const { view, extra, justUnlocked } = _parseHash();
    if (view !== currentView || extra !== currentExtra) {
        _skipHashUpdate = true;
        loadView(view, extra).finally(() => { _skipHashUpdate = false; });
    } else if (justUnlocked) {
        // #mogambo resolves to whatever view the user is already on (most
        // often "dashboard") — the equality check above then skips loadView
        // entirely, so NavSidebar never got nudged to re-render and pick up
        // the sessionStorage flag it just set. Nothing else changed, but
        // NavHub.update() calls React's root.render() directly, which
        // re-runs NavSidebar regardless of whether activeView's value
        // actually differs.
        window.NavHub?.update({ activeView: currentView });
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
                <h2 style="font-size:1.3rem;font-weight:700;color:#18181b;margin:0 0 8px;">Alternate CRM is waking up...</h2>
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
