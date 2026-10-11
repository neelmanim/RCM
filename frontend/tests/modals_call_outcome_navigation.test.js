/**
 * Test for js/views/modals.js — call-outcome submit navigating back to the
 * SAME lead, not the dashboard.
 *
 * RCA 2026-08-21 (LIVE, prod): the same stale-closure shape as the No-Show
 * modal race (modals_no_show.test.js) — the post-submit setTimeout used to
 * read the *live* activeCallLeadId module variable 900ms later instead of
 * capturing it at submit time. Reported live: an SDR made several rapid
 * repeat calls to the same lead; reopening the call modal for the next call
 * (or an Aircall auto-sync completing) before the previous submit's 900ms
 * timeout fired reassigned/reset that shared variable, so the stale timeout
 * read null and fell through to loadView(getCurrentView()) — which drops the
 * id for 'lead-detail'. This used to be a harmless no-op (lead-detail's
 * undefined-id guard was a no-op too); now that guard redirects to the
 * dashboard (v11.5.16), so the pre-existing race became a visible bug that
 * bounced the SDR off the lead they were just working on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../js/auth.js', () => ({
    currentUser: { role: 'SDR' },
}));

vi.mock('../js/api.js', () => ({
    logCall: vi.fn().mockResolvedValue({ lead_status: 'Calling' }),
    createUser: vi.fn(),
    createLead: vi.fn(),
    markNoShow: vi.fn(),
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

const { initModals, openCallModal } = await import('../js/views/modals.js');
const { logCall } = await import('../js/api.js');

describe('Call-outcome submit navigates back to the same lead', () => {
    let loadView;
    const LEAD_ID = 'lead-42a53641';

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="call-log-modal" style="display:none">
                <span id="call-modal-avatar"></span>
                <span id="call-modal-lead-name"></span>
                <span id="call-modal-phone"></span>
                <input id="call-modal-lead-id" />
                <input id="call-modal-attempt-count" />
                <input id="call-modal-max-attempts" />
                <select id="call-outcome-select"><option value="No Answer" selected>No Answer</option></select>
                <textarea id="call-notes"></textarea>
                <div id="call-notes-section"></div>
                <label id="call-notes-label"></label>
                <div id="outcome-question-section"></div>
                <div id="outcome-chips-section"></div>
                <button id="submit-call-btn">Log Call →</button>
                <button id="branch-no-btn"></button>
                <button id="branch-yes-btn"></button>
                <div id="meeting-connect-warning" style="display:none"></div>
            </div>
        `;
        loadView = vi.fn();
        // Simulate the reported scenario: the SDR is currently viewing the
        // lead-detail page (getCurrentView() reflects that).
        initModals(loadView, () => 'lead-detail', () => []);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function _submitOutcome(leadId, leadName) {
        await openCallModal(leadId, leadName, '+919552419307');
        // _showState1() resets the outcome select and disables submit until a
        // branch/outcome is picked via the chip-UI flow — exercise the submit
        // handler directly, so set the equivalent end state here.
        document.getElementById('call-outcome-select').value = 'No Answer';
        document.getElementById('submit-call-btn').disabled = false;
        document.getElementById('submit-call-btn').click();
        await vi.advanceTimersByTimeAsync(0); // flush the awaited logCall()
    }

    it('reloads lead-detail WITH the lead id, not just the bare view name', async () => {
        await _submitOutcome(LEAD_ID, 'Neel Test Prod');
        expect(logCall).toHaveBeenCalledWith(LEAD_ID, expect.objectContaining({ outcome: 'No Answer' }));

        await vi.advanceTimersByTimeAsync(900); // the post-submit setTimeout

        expect(loadView).toHaveBeenCalledWith('lead-detail', LEAD_ID);
        // Must never be called with just the bare view name for lead-detail —
        // that's exactly what used to drop the id and bounce to the dashboard.
        expect(loadView).not.toHaveBeenCalledWith('lead-detail');
    });

    it('does not lose the lead id if the modal is reopened for another call before the 900ms timeout fires', async () => {
        const OTHER_LEAD_ID = 'lead-other-999';

        await _submitOutcome(LEAD_ID, 'Neel Test Prod');
        expect(logCall).toHaveBeenCalledWith(LEAD_ID, expect.objectContaining({ outcome: 'No Answer' }));

        // Before that 900ms elapses, the SDR dials again and the modal reopens
        // for a different call — this reassigns the shared module variable
        // the stale timeout used to read directly.
        await openCallModal(OTHER_LEAD_ID, 'Someone Else', '+911111111111');

        await vi.advanceTimersByTimeAsync(900);

        // The first call's own timeout must still navigate back to the LEAD
        // it was actually submitted for, not the now-reassigned other lead,
        // and never with a bare view name (the redirect-to-dashboard trap).
        expect(loadView).toHaveBeenCalledWith('lead-detail', LEAD_ID);
        expect(loadView).not.toHaveBeenCalledWith('lead-detail');
    });
});
