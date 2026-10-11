/**
 * Test for js/views/modals.js — No-Show modal submit-handler stale-closure race.
 *
 * RCA 2026-08-20 (same shape as the dialer widget bug): the 800ms setTimeout
 * after a successful markNoShow() used to read the live module-level
 * activeNoShowLeadId when it fired. If the modal was reopened for a
 * DIFFERENT lead within that 800ms window, the stale timeout would still
 * close the (reopened) modal and navigate to the WRONG lead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../js/auth.js', () => ({
    currentUser: { role: 'SDR' },
}));

vi.mock('../js/api.js', () => ({
    logCall: vi.fn(),
    createUser: vi.fn(),
    createLead: vi.fn(),
    markNoShow: vi.fn().mockResolvedValue({ no_show_count: 1 }),
    fetchCallOutcomes: vi.fn(),
    fetchCallOutcomeStatus: vi.fn(),
    createDisqualifyRequest: vi.fn(),
    getEmailStatus: vi.fn(),
    getCalendarAvailability: vi.fn(),
    draftMeetingAgenda: vi.fn(),
}));

vi.mock('../js/utils.js', () => ({
    showToast: vi.fn(),
}));

vi.mock('../js/mp.js', () => ({
    mp: { track: vi.fn() },
}));

const { initModals, openNoShowModal } = await import('../js/views/modals.js');
const { markNoShow } = await import('../js/api.js');

describe('No-Show modal submit stale-closure race', () => {
    let loadView;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="no-show-modal" style="display:none">
                <input id="no-show-lead-id" />
                <span id="no-show-lead-name"></span>
                <textarea id="no-show-reason"></textarea>
                <span id="no-show-char-count"></span>
                <button id="submit-no-show-btn"></button>
            </div>
        `;
        loadView = vi.fn();
        initModals(loadView, () => 'lead-detail', () => []);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not navigate to the stale lead if the modal is reopened for a different lead before the post-submit timeout fires', async () => {
        const modal = document.getElementById('no-show-modal');
        const reasonEl = document.getElementById('no-show-reason');
        const submitBtn = document.getElementById('submit-no-show-btn');

        // Open for lead 1 and submit a valid reason.
        openNoShowModal(1, 'Lead One');
        reasonEl.value = 'valid enough reason';
        submitBtn.disabled = false;
        submitBtn.click();

        // Let the awaited markNoShow() resolve and the 800ms timeout get scheduled.
        await vi.advanceTimersByTimeAsync(0);
        expect(markNoShow).toHaveBeenCalledWith(1, 'valid enough reason');

        // Before that 800ms elapses, the SDR reopens the modal for a different lead.
        openNoShowModal(2, 'Lead Two');

        await vi.advanceTimersByTimeAsync(800);

        // The stale timeout for lead 1 must not have closed the modal or
        // navigated away from the lead the modal is now open for.
        expect(loadView).not.toHaveBeenCalledWith('lead-detail', 1);
        expect(document.getElementById('no-show-lead-id').value).toBe('2');
        expect(modal.style.display).toBe('flex');
    });
});
