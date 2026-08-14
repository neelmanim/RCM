/**
 * error_reporter.js — RCM Global Frontend Error Reporter
 *
 * Captures all JS errors and failed API calls, translates them into plain English,
 * and sends them to the backend Error Logs endpoint.
 *
 * Safety guarantees:
 *  - POST /api/admin/error-logs failures are ALWAYS silent (no recursive loop)
 *  - AbortError (user navigation) and 401/403 (session expiry) are NEVER logged
 *  - localhost is NEVER reported to production
 *  - Client-side dedup: same (endpoint + status) within 30s → skip
 *  - Errors are queued if token is not yet available, flushed on first auth
 *
 * Usage (in app.js):
 *   import { initErrorReporter, reportError } from './error_reporter.js';
 *   initErrorReporter({ getToken: () => localStorage.getItem('token'), apiBase: API_BASE });
 */

import { API_BASE } from './auth.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _isReporting   = false;           // Guard: prevent recursive error reports
let _getToken      = () => null;
let _pendingErrors = [];              // Queue for errors before auth is ready
let _dedupCache    = new Map();       // key → last reported timestamp (ms)
const DEDUP_WINDOW_MS = 30_000;      // 30 seconds

// ── Severity / category maps ──────────────────────────────────────────────────
const HTTP_ERROR_MAP = [
    // [statusMin, statusMax, category, severity, title, description, hint]
    [0, 0, "api", "warning",
        "No internet connection detected",
        "Your device lost internet access. The action was not saved.",
        "Check your WiFi or network connection and try again."],
    [408, 408, "api", "warning",
        "The request timed out",
        "The server took too long to respond. This usually happens during high load.",
        "Wait a few seconds and try again. If it keeps happening, contact your admin."],
    [422, 422, "api", "warning",
        "The request was rejected — something is missing",
        "The server received the request but couldn't process it because required information is missing or invalid.",
        "Check that all required fields are filled in correctly and try again."],
    [429, 429, "api", "warning",
        "Too many requests — please slow down",
        "The system received too many requests at once and is temporarily rate-limiting your account.",
        "Wait 30 seconds and try again."],
    [500, 599, "api", "critical",
        "An unexpected server error occurred",
        "The server encountered an internal error and could not complete the request.",
        "Try refreshing the page and repeating the action. If this keeps happening, contact support."],
    [503, 503, "api", "critical",
        "The server is temporarily unavailable",
        "The server is down for maintenance or is overloaded.",
        "Wait a few minutes and try again. The engineering team is notified automatically."],
];

// Endpoint-specific overrides (matched on substring)
const ENDPOINT_OVERRIDES = [
    {match: "/ai-research",   category: "research",
        title: "AI Research encountered an error",
        description: "The AI research service failed to complete the analysis. This usually happens when the AI provider is temporarily overloaded.",
        hint: "Click 'Run AI Research' again — it almost always works on the second try."},
    {match: "/dialer",        category: "dialer",
        title: "The calling system encountered an error",
        description: "Something went wrong with the dialer or calling service.",
        hint: "Refresh the page and try the call again. If it fails again, check your dialer settings."},
    {match: "/upload",        category: "upload",
        title: "The upload failed",
        description: "The file upload did not complete successfully.",
        hint: "Try uploading the file again. Check that it's a valid CSV and under the size limit."},
    {match: "/kanban",        category: "api",
        title: "Could not move the lead to the next stage",
        description: "The lead status could not be updated. This usually means a required step hasn't been completed yet.",
        hint: "Check that all required fields and research are complete before moving the lead forward."},
    {match: "/salesforce",    category: "salesforce",
        title: "Salesforce sync encountered an error",
        description: "The lead data could not be synced with Salesforce.",
        hint: "Check the Salesforce connection in Settings, then try syncing again."},
    {match: "/auth",          category: "auth",
        title: "Authentication error",
        description: "There was a problem with your login session.",
        hint: "Try logging out and logging back in."},
];

// ── Deduplication ─────────────────────────────────────────────────────────────
function _isDuplicate(key) {
    const now = Date.now();
    if (_dedupCache.has(key)) {
        if (now - _dedupCache.get(key) < DEDUP_WINDOW_MS) return true;
    }
    _dedupCache.set(key, now);
    // Clean up old entries periodically
    if (_dedupCache.size > 50) {
        for (const [k, ts] of _dedupCache) {
            if (now - ts > DEDUP_WINDOW_MS) _dedupCache.delete(k);
        }
    }
    return false;
}

// ── Plain-English message builder ─────────────────────────────────────────────
function _buildMessage(endpoint, status) {
    // Check endpoint-specific overrides first
    for (const override of ENDPOINT_OVERRIDES) {
        if (endpoint && endpoint.includes(override.match)) {
            return {
                category:    override.category,
                severity:    status >= 500 ? "critical" : "warning",
                title:       override.title,
                description: override.description,
                action_hint: override.hint,
            };
        }
    }
    // Fall through to generic HTTP error map
    for (const [min, max, category, severity, title, description, hint] of HTTP_ERROR_MAP) {
        if (status >= min && status <= max) {
            return { category, severity, title, description, action_hint: hint };
        }
    }
    return {
        category:    "general",
        severity:    "warning",
        title:       "An unexpected error occurred",
        description: "Something went wrong. The team has been notified.",
        action_hint: "Try refreshing and repeating the action.",
    };
}

// ── Core report function ───────────────────────────────────────────────────────
export async function reportError({
    category    = "general",
    severity    = "warning",
    feature     = null,
    title,
    description = null,
    action_hint = null,
    http_status = null,
    endpoint    = null,
    raw_error   = null,
    context     = null,
}) {
    // ── Safety gates ─────────────────────────────────────────────────────────
    if (_isReporting) return;                           // No recursive loop
    if (window.location.hostname === 'localhost') return; // No dev pollution
    if (http_status === 401 || http_status === 403) return; // Auth redirects are normal

    const dedupKey = `${endpoint || ''}:${http_status || 0}`;
    if (_isDuplicate(dedupKey)) return;

    const token = _getToken();
    const payload = {
        severity, category, feature, title, description, action_hint,
        http_status, endpoint,
        raw_error: raw_error ? String(raw_error).slice(0, 500) : null,
        context_json: context ? JSON.stringify(context) : null,
    };

    if (!token) {
        // Queue for later (before auth is ready)
        _pendingErrors.push(payload);
        return;
    }

    _isReporting = true;
    try {
        await fetch(`${API_BASE}/api/admin/error-logs`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body:    JSON.stringify(payload),
        });
    } catch {
        // POST failure is ALWAYS silent — never recurse
    } finally {
        _isReporting = false;
    }
}

// ── Flush queued errors after auth is ready ───────────────────────────────────
export async function flushPendingErrors() {
    const pending = [..._pendingErrors];
    _pendingErrors = [];
    for (const payload of pending) {
        await reportError(payload);
    }
}

// ── apiFetch: drop-in replacement for fetch() with auto error reporting ────────
export async function apiFetch(url, options = {}, { feature = null } = {}) {
    let response;
    try {
        response = await fetch(url, options);
    } catch (networkErr) {
        // Network failure (offline, DNS failure, etc.)
        if (networkErr.name === 'AbortError') throw networkErr; // Navigation — don't log
        const msg = _buildMessage(url, 0);
        await reportError({
            ...msg,
            feature,
            endpoint: url,
            http_status: 0,
            raw_error: networkErr.message,
        });
        throw networkErr;
    }

    if (!response.ok) {
        const status = response.status;
        // Skip 401/403 — handled by auth redirect
        if (status !== 401 && status !== 403) {
            const msg = _buildMessage(url, status);
            await reportError({
                ...msg,
                feature,
                endpoint: url,
                http_status: status,
            });
        }
    }
    return response;
}

// ── Global error listeners ─────────────────────────────────────────────────────
function _installGlobalHandlers() {
    window.onerror = (message, source, lineno, colno, error) => {
        if (_isReporting) return false;
        reportError({
            severity:    "warning",
            category:    "general",
            title:       "An unexpected JavaScript error occurred",
            description: `A script error happened in the application. Technical detail: ${message}`,
            action_hint: "Refresh the page. If the error keeps appearing, contact support.",
            raw_error:   error ? error.stack : message,
            context:     { source, lineno, colno },
        });
        return false; // Don't suppress the browser default handling
    };

    window.addEventListener('unhandledrejection', (event) => {
        if (_isReporting) return;
        const reason = event.reason;
        // Suppress AbortError (navigation cancels) and auth redirects (401/403)
        if (reason && reason.name === 'AbortError') return;
        const reasonStr = reason ? (reason.stack || String(reason)) : 'Unhandled promise rejection';
        if (reasonStr.includes('401') || reasonStr.includes('403')) return;
        reportError({
            severity:    "warning",
            category:    "general",
            title:       "A background operation failed unexpectedly",
            description: "An asynchronous operation (like loading data or syncing) failed without being caught.",
            action_hint: "Refresh the page and try again.",
            raw_error:   reasonStr,
        });
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initErrorReporter({ getToken }) {
    _getToken = getToken || (() => localStorage.getItem('token'));
    _installGlobalHandlers();
}
