// ── auth.js — Token management, user identity, auth headers ──────────────────
// API_BASE: if the frontend is deployed separately, config.js sets __APP_CONFIG__.API_BASE
// to point at the backend. When co-hosted, falls back to window.location.origin.
export const API_BASE = (window.__APP_CONFIG__?.API_BASE) || window.location.origin;

// ── Token resolution ─────────────────────────────────────────────────────────
// View-As tokens go into sessionStorage (tab-scoped) to avoid overwriting the
// admin's real JWT in localStorage.  Normal OAuth tokens stay in localStorage.
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('token')) {
    const incomingToken = urlParams.get('token');
    // If user already has a real token in localStorage, this is a View-As tab
    // → store in sessionStorage so the admin's original tab is unaffected.
    if (localStorage.getItem('crm_token')) {
        sessionStorage.setItem('crm_view_as_token', incomingToken);
    } else {
        // First-time login via OAuth callback → store normally
        localStorage.setItem('crm_token', incomingToken);
    }
    window.history.replaceState({}, '', window.location.pathname);
}

// View-As token takes priority in this tab; falls back to real token
const _viewAsToken = sessionStorage.getItem('crm_view_as_token');
export const CRM_TOKEN = _viewAsToken || localStorage.getItem('crm_token');
export const isViewAsSession = !!_viewAsToken;

function parseJwt(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return null; }
}

export const currentUser = CRM_TOKEN ? parseJwt(CRM_TOKEN) : null;

// Check if token is expired (exp is in seconds since epoch)
const isTokenExpired = currentUser && currentUser.exp && (currentUser.exp * 1000 < Date.now());

// Redirect to login if not authenticated or token expired
if (!currentUser || isTokenExpired) {
    sessionStorage.removeItem('crm_view_as_token');
    localStorage.removeItem('crm_token');
    window.location.href = 'login.html';
    throw new Error('Not authenticated or session expired, redirecting to login...');
}

// V2 role helpers (also supports V1 "Admin" → treat as Super Admin)
export const isSuperAdmin = currentUser?.role === 'Super Admin' || currentUser?.role === 'Admin';
export const isPodAdmin   = currentUser?.role === 'Pod Admin';
export const isAdmin      = isSuperAdmin || isPodAdmin;
export const isSDR        = currentUser?.role === 'SDR' || currentUser?.role === 'AE';
export const userPodId    = currentUser?.pod_id || null;

// v4: Per-SDR feature flags (from JWT — set by admin toggle)
// Admins always have dialer/email access (they manage it); only SDRs are gated
export const dialerEnabled    = isAdmin ? true : (currentUser?.dialer_enabled ?? false);
export const emailSyncEnabled = isAdmin ? true : (currentUser?.email_sync_enabled ?? false);


export function authHeaders() {
    // View-As tab uses sessionStorage token; original tab uses localStorage token.
    // This ensures admin's real session is never overwritten by View-As.
    const token = sessionStorage.getItem('crm_view_as_token')
               || localStorage.getItem('crm_token')
               || CRM_TOKEN;
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}
