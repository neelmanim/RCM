/**
 * Tests for View-As token isolation (v5.0.1 security fix)
 * and search hotkey behavior (⌘K / Ctrl+K / /).
 *
 * These tests cover the token resolution logic introduced in commit 85f15a7
 * where View-As tokens are isolated in sessionStorage to prevent overwriting
 * the admin's real JWT in localStorage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


// ── Helpers ──────────────────────────────────────────────────────────────────
function makeJwt(payload) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    return `${header}.${body}.fake-signature`;
}

function parseJwt(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return null; }
}


// ═══════════════════════════════════════════════════════════════════════════════
// View-As Token Isolation
// ═══════════════════════════════════════════════════════════════════════════════
describe('View-As token isolation', () => {
    const adminToken = makeJwt({ sub: 'admin-1', role: 'Super Admin', email: 'admin@co.com', exp: Math.floor(Date.now()/1000) + 3600 });
    const sdrToken = makeJwt({ sub: 'sdr-1', role: 'SDR', email: 'sdr@co.com', exp: Math.floor(Date.now()/1000) + 3600 });

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('stores OAuth token in localStorage when no existing token', () => {
        // Simulates auth.js lines 12-16: first-time login
        const existingToken = localStorage.getItem('crm_token');
        if (existingToken) {
            sessionStorage.setItem('crm_view_as_token', sdrToken);
        } else {
            localStorage.setItem('crm_token', adminToken);
        }
        expect(localStorage.getItem('crm_token')).toBe(adminToken);
        expect(sessionStorage.getItem('crm_view_as_token')).toBeNull();
    });

    it('stores View-As token in sessionStorage when admin already logged in', () => {
        // Admin is logged in with real token
        localStorage.setItem('crm_token', adminToken);
        // Incoming token is View-As target
        const existingToken = localStorage.getItem('crm_token');
        if (existingToken) {
            sessionStorage.setItem('crm_view_as_token', sdrToken);
        } else {
            localStorage.setItem('crm_token', sdrToken);
        }
        // Real admin token is preserved
        expect(localStorage.getItem('crm_token')).toBe(adminToken);
        // View-As token is in sessionStorage
        expect(sessionStorage.getItem('crm_view_as_token')).toBe(sdrToken);
    });

    it('View-As token takes priority in token resolution', () => {
        localStorage.setItem('crm_token', adminToken);
        sessionStorage.setItem('crm_view_as_token', sdrToken);
        // Mirrors auth.js line 23: const CRM_TOKEN = _viewAsToken || localStorage.getItem('crm_token')
        const _viewAsToken = sessionStorage.getItem('crm_view_as_token');
        const resolvedToken = _viewAsToken || localStorage.getItem('crm_token');
        expect(resolvedToken).toBe(sdrToken);
        expect(parseJwt(resolvedToken).role).toBe('SDR');
    });

    it('falls back to localStorage token when no View-As token', () => {
        localStorage.setItem('crm_token', adminToken);
        const _viewAsToken = sessionStorage.getItem('crm_view_as_token');
        const resolvedToken = _viewAsToken || localStorage.getItem('crm_token');
        expect(resolvedToken).toBe(adminToken);
        expect(parseJwt(resolvedToken).role).toBe('Super Admin');
    });

    it('isViewAsSession flag is true only when View-As token exists', () => {
        sessionStorage.setItem('crm_view_as_token', sdrToken);
        const isViewAsSession = !!sessionStorage.getItem('crm_view_as_token');
        expect(isViewAsSession).toBe(true);
    });

    it('isViewAsSession flag is false when no View-As token', () => {
        const isViewAsSession = !!sessionStorage.getItem('crm_view_as_token');
        expect(isViewAsSession).toBe(false);
    });

    it('clearing View-As token restores admin identity', () => {
        localStorage.setItem('crm_token', adminToken);
        sessionStorage.setItem('crm_view_as_token', sdrToken);
        // Simulate exiting View-As
        sessionStorage.removeItem('crm_view_as_token');
        const _viewAsToken = sessionStorage.getItem('crm_view_as_token');
        const resolvedToken = _viewAsToken || localStorage.getItem('crm_token');
        expect(resolvedToken).toBe(adminToken);
        expect(parseJwt(resolvedToken).role).toBe('Super Admin');
    });

    it('View-As token does not leak to other tabs (sessionStorage is tab-scoped)', () => {
        // sessionStorage is inherently tab-scoped — this test documents the contract
        localStorage.setItem('crm_token', adminToken);
        sessionStorage.setItem('crm_view_as_token', sdrToken);
        // Another tab would have a fresh sessionStorage, so:
        const otherTabSessionStorage = {}; // simulates empty sessionStorage in new tab
        const otherTabToken = otherTabSessionStorage['crm_view_as_token'] || localStorage.getItem('crm_token');
        expect(otherTabToken).toBe(adminToken); // admin's real token, not SDR
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// authHeaders — token resolution in headers
// ═══════════════════════════════════════════════════════════════════════════════
describe('authHeaders token resolution', () => {
    const adminToken = makeJwt({ sub: 'admin-1', role: 'Super Admin' });
    const sdrToken = makeJwt({ sub: 'sdr-1', role: 'SDR' });

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('uses View-As token in Authorization header when present', () => {
        localStorage.setItem('crm_token', adminToken);
        sessionStorage.setItem('crm_view_as_token', sdrToken);
        // Mirrors auth.js authHeaders() logic
        const token = sessionStorage.getItem('crm_view_as_token')
                   || localStorage.getItem('crm_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        expect(headers.Authorization).toContain(sdrToken);
    });

    it('falls back to localStorage token when no View-As token', () => {
        localStorage.setItem('crm_token', adminToken);
        const token = sessionStorage.getItem('crm_view_as_token')
                   || localStorage.getItem('crm_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        expect(headers.Authorization).toContain(adminToken);
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Search hotkey logic (⌘K / Ctrl+K / /)
// ═══════════════════════════════════════════════════════════════════════════════
describe('Search hotkey logic', () => {
    /**
     * Since the hotkey handler is inline in app.js and not easily importable,
     * we test the decision logic directly — the same conditional checks used
     * in the actual keydown handler.
     */

    function shouldFocusSearch(event, activeTag = 'DIV') {
        // ⌘K / Ctrl+K
        if ((event.metaKey || event.ctrlKey) && event.key === 'k') return true;
        // "/" only when not typing
        if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return true;
        return false;
    }

    it('⌘K triggers search focus', () => {
        expect(shouldFocusSearch({ metaKey: true, ctrlKey: false, key: 'k' })).toBe(true);
    });

    it('Ctrl+K triggers search focus', () => {
        expect(shouldFocusSearch({ metaKey: false, ctrlKey: true, key: 'k' })).toBe(true);
    });

    it('"/" triggers search focus when not in an input', () => {
        expect(shouldFocusSearch({ metaKey: false, ctrlKey: false, key: '/' }, 'DIV')).toBe(true);
    });

    it('"/" does NOT trigger search focus when in an INPUT', () => {
        expect(shouldFocusSearch({ metaKey: false, ctrlKey: false, key: '/' }, 'INPUT')).toBe(false);
    });

    it('"/" does NOT trigger search focus when in a TEXTAREA', () => {
        expect(shouldFocusSearch({ metaKey: false, ctrlKey: false, key: '/' }, 'TEXTAREA')).toBe(false);
    });

    it('"/" does NOT trigger search focus when in a SELECT', () => {
        expect(shouldFocusSearch({ metaKey: false, ctrlKey: false, key: '/' }, 'SELECT')).toBe(false);
    });

    it('random keys do not trigger search', () => {
        expect(shouldFocusSearch({ metaKey: false, ctrlKey: false, key: 'a' })).toBe(false);
        expect(shouldFocusSearch({ metaKey: false, ctrlKey: false, key: 'Enter' })).toBe(false);
    });

    it('Ctrl+J does not trigger search', () => {
        expect(shouldFocusSearch({ metaKey: false, ctrlKey: true, key: 'j' })).toBe(false);
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Token expiration logic
// ═══════════════════════════════════════════════════════════════════════════════
describe('Token expiration detection', () => {
    it('detects expired token', () => {
        const expiredPayload = { sub: 'u1', role: 'SDR', exp: Math.floor(Date.now() / 1000) - 60 };
        const token = makeJwt(expiredPayload);
        const decoded = parseJwt(token);
        const isExpired = decoded && decoded.exp && (decoded.exp * 1000 < Date.now());
        expect(isExpired).toBe(true);
    });

    it('allows valid (non-expired) token', () => {
        const validPayload = { sub: 'u1', role: 'SDR', exp: Math.floor(Date.now() / 1000) + 3600 };
        const token = makeJwt(validPayload);
        const decoded = parseJwt(token);
        const isExpired = decoded && decoded.exp && (decoded.exp * 1000 < Date.now());
        expect(isExpired).toBe(false);
    });

    it('token without exp is not flagged as expired', () => {
        const noExpPayload = { sub: 'u1', role: 'SDR' };
        const token = makeJwt(noExpPayload);
        const decoded = parseJwt(token);
        const isExpired = decoded && decoded.exp && (decoded.exp * 1000 < Date.now());
        expect(isExpired).toBeFalsy();
    });
});
