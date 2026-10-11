/**
 * Tests for js/views/lead_list.js — loadPage() teardown race.
 *
 * RCA 2026-08-18 (prod, unhandled rejection reported by an SDR): the
 * debounced search input calls loadPage() fire-and-forget. If the user
 * navigates away from the Leads view before the 400ms debounce fires,
 * #leads-tbody no longer exists and `.innerHTML` on null threw — with
 * nothing awaiting loadPage(), that surfaced as an unhandled promise
 * rejection ("A background operation failed unexpectedly").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../js/auth.js', () => ({
    isAdmin: false,
    isPodAdmin: false,
}));

vi.mock('../js/api.js', () => ({
    fetchLeadCompanies: vi.fn().mockResolvedValue([]),
    fetchAdminUsers: vi.fn().mockResolvedValue([]),
    fetchMyDisqualifyRequests: vi.fn().mockResolvedValue({ requests: [] }),
    fetchLeads: vi.fn().mockResolvedValue({ data: [], total: 0, pages: 1 }),
    reprioritizeLead: vi.fn(),
}));

const { renderLeads } = await import('../js/views/lead_list.js');

describe('lead_list loadPage() teardown race', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="root"></div>';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not throw when the debounced search fires after the view was torn down', async () => {
        const container = document.getElementById('root');
        await renderLeads(container, null, () => {}, () => {});

        const searchInput = document.getElementById('lead-search');
        expect(searchInput).toBeTruthy();

        // Simulate navigating away (router replaces this view's markup)
        // before the 400ms debounce timer has a chance to fire.
        container.innerHTML = '';

        let unhandledReason = null;
        const onUnhandled = (reason) => { unhandledReason = reason; };
        process.on('unhandledRejection', onUnhandled);

        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(500);
        await Promise.resolve(); // flush any pending microtasks from loadPage()

        process.off('unhandledRejection', onUnhandled);
        expect(unhandledReason).toBeNull();
    });
});
