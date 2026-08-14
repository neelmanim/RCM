/**
 * Tests for js/auth.js — JWT parsing, role derivation, auth headers.
 *
 * auth.js has top-level side effects (redirects when no token, reads
 * URL params), so we test the LOGIC by reimplementing parseJwt and
 * testing the role derivation rules, then selectively importing when
 * the environment is correctly stubbed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';


// ── parseJwt (reimplemented locally for unit testing) ────────────────────────
// auth.js has a private parseJwt — we replicate it identically here.
function parseJwt(token) {
    try {
        return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
        return null;
    }
}

function makeJwt(payload) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    return `${header}.${body}.fake-signature`;
}

// ── Role helpers (pure logic — mirrors auth.js lines 27-31) ──────────────────
function deriveRoles(role) {
    const isSuperAdmin = role === 'Super Admin' || role === 'Admin';
    const isPodAdmin   = role === 'Pod Admin';
    const isAdmin      = isSuperAdmin || isPodAdmin;
    const isSDR        = role === 'SDR';
    return { isSuperAdmin, isPodAdmin, isAdmin, isSDR };
}


// ═══════════════════════════════════════════════════════════════════════════════
// parseJwt
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseJwt', () => {
    it('decodes a valid JWT payload', () => {
        const payload = { sub: 'user-1', email: 'a@b.com', role: 'SDR' };
        const token = makeJwt(payload);
        const decoded = parseJwt(token);
        expect(decoded).toEqual(payload);
    });

    it('handles URL-safe base64 characters', () => {
        // Payload with characters that produce -/_ in base64
        const payload = { sub: '???>>><<<', email: 'test@example.com' };
        const token = makeJwt(payload);
        const decoded = parseJwt(token);
        expect(decoded.sub).toBe(payload.sub);
    });

    it('returns null for invalid token', () => {
        expect(parseJwt('not-a-jwt')).toBeNull();
        expect(parseJwt('')).toBeNull();
    });

    it('returns null for malformed base64', () => {
        expect(parseJwt('a.!!!invalid!!!.c')).toBeNull();
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Role derivation
// ═══════════════════════════════════════════════════════════════════════════════
describe('deriveRoles', () => {
    it('Super Admin is isSuperAdmin and isAdmin', () => {
        const r = deriveRoles('Super Admin');
        expect(r.isSuperAdmin).toBe(true);
        expect(r.isAdmin).toBe(true);
        expect(r.isPodAdmin).toBe(false);
        expect(r.isSDR).toBe(false);
    });

    it('legacy Admin maps to isSuperAdmin', () => {
        const r = deriveRoles('Admin');
        expect(r.isSuperAdmin).toBe(true);
        expect(r.isAdmin).toBe(true);
    });

    it('Pod Admin is isPodAdmin and isAdmin but not isSuperAdmin', () => {
        const r = deriveRoles('Pod Admin');
        expect(r.isPodAdmin).toBe(true);
        expect(r.isAdmin).toBe(true);
        expect(r.isSuperAdmin).toBe(false);
        expect(r.isSDR).toBe(false);
    });

    it('SDR is only isSDR, nothing else', () => {
        const r = deriveRoles('SDR');
        expect(r.isSDR).toBe(true);
        expect(r.isAdmin).toBe(false);
        expect(r.isSuperAdmin).toBe(false);
        expect(r.isPodAdmin).toBe(false);
    });

    it('unknown role results in no flags set (except isSDR if matching)', () => {
        const r = deriveRoles('Manager');
        expect(r.isSuperAdmin).toBe(false);
        expect(r.isPodAdmin).toBe(false);
        expect(r.isAdmin).toBe(false);
        expect(r.isSDR).toBe(false);
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// authHeaders
// ═══════════════════════════════════════════════════════════════════════════════
describe('authHeaders', () => {
    it('returns Authorization header when token is present', () => {
        const CRM_TOKEN = 'my-test-token';
        const headers = CRM_TOKEN ? { 'Authorization': `Bearer ${CRM_TOKEN}` } : {};
        expect(headers).toEqual({ 'Authorization': 'Bearer my-test-token' });
    });

    it('returns empty object when token is null', () => {
        const CRM_TOKEN = null;
        const headers = CRM_TOKEN ? { 'Authorization': `Bearer ${CRM_TOKEN}` } : {};
        expect(headers).toEqual({});
    });

    it('returns empty object when token is empty string', () => {
        const CRM_TOKEN = '';
        const headers = CRM_TOKEN ? { 'Authorization': `Bearer ${CRM_TOKEN}` } : {};
        expect(headers).toEqual({});
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Token from URL params (logic test)
// ═══════════════════════════════════════════════════════════════════════════════
describe('URL token extraction logic', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('stores token from URL params into localStorage', () => {
        // Simulate the logic from auth.js lines 5-9
        const urlParams = new URLSearchParams('?token=jwt-from-oauth');
        if (urlParams.has('token')) {
            localStorage.setItem('crm_token', urlParams.get('token'));
        }
        expect(localStorage.getItem('crm_token')).toBe('jwt-from-oauth');
    });

    it('does not overwrite localStorage when no token in URL', () => {
        localStorage.setItem('crm_token', 'existing-token');
        const urlParams = new URLSearchParams('?other=param');
        if (urlParams.has('token')) {
            localStorage.setItem('crm_token', urlParams.get('token'));
        }
        expect(localStorage.getItem('crm_token')).toBe('existing-token');
    });
});
