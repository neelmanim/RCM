/**
 * Tests for js/api.js — Fetch wrappers (URL construction, methods, headers).
 *
 * We mock global fetch and the auth module to test each API function
 * in isolation, verifying correct URLs, HTTP methods, headers, and
 * response handling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock auth.js BEFORE importing api.js ─────────────────────────────────────
vi.mock('../js/auth.js', () => ({
    API_BASE: 'http://localhost:8000',
    authHeaders: () => ({ 'Authorization': 'Bearer test-token' }),
    isAdmin: true,
}));

import * as api from '../js/api.js';


// ── Global fetch mock setup ──────────────────────────────────────────────────
function mockFetch(data, ok = true, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
        ok,
        status,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});


// ═══════════════════════════════════════════════════════════════════════════════
// fetchLeads
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchLeads', () => {
    it('hits /api/leads with default pagination', async () => {
        mockFetch({ data: [], total: 0 });
        await api.fetchLeads();
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('/api/leads');
        expect(url).toContain('page=1');
        expect(url).toContain('per_page=20');
    });

    it('includes search and status filters', async () => {
        mockFetch({ data: [] });
        await api.fetchLeads({ search: 'acme', status: 'Calling', page: 2 });
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('search=acme');
        expect(url).toContain('status=Calling');
        expect(url).toContain('page=2');
    });

    it('throws on non-ok response', async () => {
        mockFetch({}, false, 500);
        await expect(api.fetchLeads()).rejects.toThrow('Failed to fetch leads');
    });

    it('includes Disqualified status filter', async () => {
        mockFetch({ data: [] });
        await api.fetchLeads({ status: 'Disqualified', page: 1 });
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('status=Disqualified');
    });

    it('attaches auth headers', async () => {
        mockFetch({ data: [] });
        await api.fetchLeads();
        const opts = fetch.mock.calls[0][1];
        expect(opts.headers).toHaveProperty('Authorization', 'Bearer test-token');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// fetchKanbanLeads
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchKanbanLeads', () => {
    it('calls GET /api/leads/kanban', async () => {
        mockFetch([]);
        await api.fetchKanbanLeads();
        expect(fetch.mock.calls[0][0]).toContain('/api/leads/kanban');
    });

    it('throws on non-ok response', async () => {
        mockFetch({}, false);
        await expect(api.fetchKanbanLeads()).rejects.toThrow();
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// fetchDashboardStats
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchDashboardStats', () => {
    it('calls GET /api/leads/dashboard-stats', async () => {
        mockFetch({ total: 10, status_counts: {} });
        await api.fetchDashboardStats();
        expect(fetch.mock.calls[0][0]).toContain('/api/leads/dashboard-stats');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Lead CRUD
// ═══════════════════════════════════════════════════════════════════════════════
describe('createLead', () => {
    it('sends POST with JSON body', async () => {
        mockFetch({ id: '1' });
        const payload = { first_name: 'John', email: 'j@t.com' };
        await api.createLead(payload);
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/leads');
        expect(opts.method).toBe('POST');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(opts.body)).toEqual(payload);
    });
});

describe('patchLead', () => {
    it('sends PATCH to /api/leads/:id', async () => {
        mockFetch({ id: 'abc' });
        await api.patchLead('abc', { company: 'ACME' });
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/leads/abc');
        expect(opts.method).toBe('PATCH');
    });
});

describe('fetchLead', () => {
    it('fetches a single lead by id', async () => {
        mockFetch({ id: 'lead-1', first_name: 'Jane' });
        const result = await api.fetchLead('lead-1');
        expect(fetch.mock.calls[0][0]).toContain('/api/leads/lead-1');
        expect(result.first_name).toBe('Jane');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Notes
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchLeadNotes', () => {
    it('calls GET /api/leads/:id/notes', async () => {
        mockFetch([{ id: 'n1', content: 'Hello' }]);
        const result = await api.fetchLeadNotes('L1');
        expect(fetch.mock.calls[0][0]).toContain('/api/leads/L1/notes');
        expect(result[0].content).toBe('Hello');
    });

    it('returns empty array on non-ok response', async () => {
        mockFetch(null, false);
        const result = await api.fetchLeadNotes('L1');
        expect(result).toEqual([]);
    });
});

describe('addLeadNote', () => {
    it('sends POST with content and author', async () => {
        mockFetch({ id: 'n1' });
        await api.addLeadNote('L1', 'Great call', 'Admin');
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/leads/L1/notes');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ content: 'Great call', author: 'Admin' });
    });
});

describe('deleteLeadNote', () => {
    it('sends DELETE to /api/leads/:leadId/notes/:noteId', async () => {
        mockFetch({});
        await api.deleteLeadNote('L1', 'N1');
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/leads/L1/notes/N1');
        expect(opts.method).toBe('DELETE');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Tasks
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchLeadTasks', () => {
    it('returns empty array on non-ok', async () => {
        mockFetch(null, false);
        expect(await api.fetchLeadTasks('L1')).toEqual([]);
    });
});

describe('addLeadTask', () => {
    it('sends POST with title and due_date', async () => {
        mockFetch({ id: 't1' });
        await api.addLeadTask('L1', 'Follow up', '2026-04-01');
        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body).toEqual({ title: 'Follow up', due_date: '2026-04-01' });
    });
});

describe('deleteLeadTask', () => {
    it('sends DELETE to correct URL', async () => {
        mockFetch({});
        await api.deleteLeadTask('L1', 'T1');
        expect(fetch.mock.calls[0][0]).toContain('/api/leads/L1/tasks/T1');
        expect(fetch.mock.calls[0][1].method).toBe('DELETE');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Calls
// ═══════════════════════════════════════════════════════════════════════════════
describe('logCall', () => {
    it('sends POST to /api/leads/:id/calls', async () => {
        mockFetch({ id: 'c1' });
        await api.logCall('L1', { outcome: 'No Answer' });
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/leads/L1/calls');
        expect(opts.method).toBe('POST');
    });
});

describe('fetchCallSummary', () => {
    it('calls GET /api/sdr/call-summary', async () => {
        mockFetch({ calls_today: 5 });
        const result = await api.fetchCallSummary();
        expect(fetch.mock.calls[0][0]).toContain('/api/sdr/call-summary');
        expect(result.calls_today).toBe(5);
    });

    it('returns null on non-ok', async () => {
        mockFetch(null, false);
        expect(await api.fetchCallSummary()).toBeNull();
    });
});

describe('closeLead', () => {
    it('sends POST to /api/leads/:id/close', async () => {
        mockFetch({ status: 'Disqualified', closed_reason: 'Customer Declined' });
        await api.closeLead('L1', 'Customer Declined');
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/leads/L1/close');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ reason: 'Customer Declined' });
    });
});

describe('updateLeadStatus', () => {
    it('sends PATCH to kanban/move endpoint', async () => {
        mockFetch({ lead: { id: 'L1', status: 'Research' } });
        const result = await api.updateLeadStatus('L1', 'Research');
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/leads/kanban/move');
        expect(url).toContain('lead_id=L1');
        expect(url).toContain('new_status=Research');
        expect(opts.method).toBe('PATCH');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Admin
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchAdminUsers', () => {
    it('calls GET /api/admin/users', async () => {
        mockFetch([{ id: 'u1' }]);
        const result = await api.fetchAdminUsers();
        expect(fetch.mock.calls[0][0]).toContain('/api/admin/users');
        expect(result).toHaveLength(1);
    });
});

describe('createUser', () => {
    it('sends POST with user payload', async () => {
        mockFetch({ id: 'u1' });
        await api.createUser({ email: 'new@t.com', role: 'SDR' });
        expect(fetch.mock.calls[0][1].method).toBe('POST');
    });
});

describe('deleteUser', () => {
    it('sends DELETE to /api/admin/users/:id', async () => {
        mockFetch({});
        await api.deleteUser('U1');
        expect(fetch.mock.calls[0][0]).toContain('/api/admin/users/U1');
        expect(fetch.mock.calls[0][1].method).toBe('DELETE');
    });
});

describe('bulkAssign', () => {
    it('sends POST with user_id and lead_ids', async () => {
        mockFetch({ assigned: 3 });
        await api.bulkAssign('user-1', ['L1', 'L2', 'L3']);
        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.user_id).toBe('user-1');
        expect(body.lead_ids).toEqual(['L1', 'L2', 'L3']);
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// PODs
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchPods', () => {
    it('calls GET /api/pods', async () => {
        mockFetch([]);
        await api.fetchPods();
        expect(fetch.mock.calls[0][0]).toContain('/api/pods');
    });
});

describe('createPod', () => {
    it('sends POST with name and admin_id', async () => {
        mockFetch({ id: 'p1' });
        await api.createPod('Engineering', 'admin-1');
        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body).toEqual({ name: 'Engineering', admin_id: 'admin-1', timezone: null });
    });

    it('sends the timezone when provided', async () => {
        mockFetch({ id: 'p1' });
        await api.createPod('US Team', 'admin-1', 'America/New_York');
        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.timezone).toBe('America/New_York');
    });
});

describe('deletePod', () => {
    it('sends DELETE to /api/pods/:id', async () => {
        mockFetch({});
        await api.deletePod('P1');
        expect(fetch.mock.calls[0][0]).toContain('/api/pods/P1');
    });
});

describe('addPodMember', () => {
    it('sends POST with user_id', async () => {
        mockFetch({});
        await api.addPodMember('P1', 'U1');
        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.user_id).toBe('U1');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Search, Leaderboard, SF Logs
// ═══════════════════════════════════════════════════════════════════════════════
describe('globalSearch', () => {
    it('encodes the query in the URL', async () => {
        mockFetch({ leads: [], users: [] });
        await api.globalSearch('John Doe');
        expect(fetch.mock.calls[0][0]).toContain('q=John%20Doe');
    });

    it('returns default on non-ok', async () => {
        mockFetch(null, false);
        const result = await api.globalSearch('test');
        expect(result).toEqual({ leads: [], users: [] });
    });
});

describe('fetchLeaderboard', () => {
    it('calls GET /api/leaderboard', async () => {
        mockFetch([]);
        await api.fetchLeaderboard();
        expect(fetch.mock.calls[0][0]).toContain('/api/leaderboard');
    });
});

describe('fetchSfLogs', () => {
    it('adds filter params to URL', async () => {
        mockFetch({ logs: [], total: 0 });
        await api.fetchSfLogs({ status: 'success', page: 2 });
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('status=success');
        expect(url).toContain('page=2');
    });
});

describe('exportSfLogsCsvUrl', () => {
    it('builds the correct export URL', () => {
        const url = api.exportSfLogsCsvUrl({ status: 'error' });
        expect(url).toContain('/api/admin/sf-logs/export');
        expect(url).toContain('status=error');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Sync Settings
// ═══════════════════════════════════════════════════════════════════════════════
describe('fetchSyncSettings', () => {
    it('returns defaults on non-ok', async () => {
        mockFetch(null, false);
        const result = await api.fetchSyncSettings();
        expect(result).toHaveProperty('lead_limit');
        expect(result).toHaveProperty('record_type_ids');
    });
});

describe('patchSyncSettings', () => {
    it('sends PATCH with fields', async () => {
        mockFetch({});
        await api.patchSyncSettings({ lead_limit: 500 });
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/admin/sync-settings');
        expect(opts.method).toBe('PATCH');
    });
});
