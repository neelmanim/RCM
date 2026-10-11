/**
 * Test for js/views/modals.js — runLeadStageAction / openDemoFailedModal.
 *
 * These were extracted from lead_detail.js's inline button handlers so they
 * could be reused from the Lead Detail Hub via a window bridge (mirrors the
 * existing window._openCallModal pattern). Covers: the success path
 * (toast + alternate:lead-detail-refresh dispatch), the updateLeadStatus
 * raw-Response failure path, and the Demo Failed modal's logCall + refresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/auth.js', () => ({
    currentUser: { role: 'SDR' },
}));

vi.mock('../js/api.js', () => ({
    logCall: vi.fn(),
    createUser: vi.fn(),
    createLead: vi.fn(),
    markNoShow: vi.fn(),
    fetchCallOutcomes: vi.fn(),
    fetchCallOutcomeStatus: vi.fn(),
    createDisqualifyRequest: vi.fn(),
    getEmailStatus: vi.fn(),
    getCalendarAvailability: vi.fn(),
    draftMeetingAgenda: vi.fn(),
    updateLeadStatus: vi.fn(),
    addDiscoveryMeeting: vi.fn(),
}));

vi.mock('../js/utils.js', () => ({
    showToast: vi.fn(),
}));

vi.mock('../js/mp.js', () => ({
    mp: { track: vi.fn() },
}));

const { runLeadStageAction, openDemoFailedModal } = await import('../js/views/modals.js');
const { updateLeadStatus, addDiscoveryMeeting, logCall } = await import('../js/api.js');
const { showToast } = await import('../js/utils.js');

describe('runLeadStageAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows a success toast and dispatches alternate:lead-detail-refresh on success', async () => {
        updateLeadStatus.mockResolvedValue({ ok: true });
        const handler = vi.fn();
        window.addEventListener('alternate:lead-detail-refresh', handler, { once: true });

        await runLeadStageAction('lead-1', 'demoSuccess');

        expect(updateLeadStatus).toHaveBeenCalledWith('lead-1', 'Demo Done');
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Demo marked as successful'), 'success', 4000);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].detail).toEqual({ leadId: 'lead-1' });
    });

    it('throws the backend detail message when updateLeadStatus returns a non-ok Response', async () => {
        updateLeadStatus.mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ detail: 'Demo already logged' }),
        });

        await expect(runLeadStageAction('lead-1', 'scheduleDemo')).rejects.toThrow('Demo already logged');
        expect(showToast).not.toHaveBeenCalled();
    });

    it('falls back to a per-action error message when the backend gives no detail', async () => {
        updateLeadStatus.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });

        await expect(runLeadStageAction('lead-1', 'completeDiscovery')).rejects.toThrow('Failed to complete discovery');
    });

    it('does not check .ok for addDiscoveryMeeting, which throws on failure instead of returning a Response', async () => {
        addDiscoveryMeeting.mockResolvedValue({ id: 'call-1' });
        await runLeadStageAction('lead-1', 'addDiscovery');
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Discovery meeting logged'), 'success', 4000);
    });

    it('rejects for an unknown action key', async () => {
        await expect(runLeadStageAction('lead-1', 'notARealAction')).rejects.toThrow('Unknown stage action');
    });
});

describe('openDemoFailedModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    it('logs the Demo Failed outcome, refreshes, and calls onResolved', async () => {
        logCall.mockResolvedValue({});
        const onResolved = vi.fn();

        openDemoFailedModal('lead-1', { phone: '+15551234567' }, { onResolved });
        document.getElementById('demo-fail-reason').value = 'Rescheduled';
        document.getElementById('demo-fail-notes').value = 'will call back Friday';

        const handler = vi.fn();
        window.addEventListener('alternate:lead-detail-refresh', handler, { once: true });

        document.getElementById('demo-fail-confirm').click();
        await vi.waitFor(() => expect(onResolved).toHaveBeenCalledOnce());

        expect(logCall).toHaveBeenCalledWith('lead-1', {
            outcome: 'Demo Failed',
            notes: '[Rescheduled] will call back Friday',
            phone: '+15551234567',
        });
        expect(handler).toHaveBeenCalledOnce();
        expect(document.getElementById('demo-failed-modal')).toBeNull();
    });

    it('replaces an already-open modal instead of stacking a second one', () => {
        openDemoFailedModal('lead-1', {});
        openDemoFailedModal('lead-2', {});
        expect(document.querySelectorAll('#demo-failed-modal').length).toBe(1);
    });
});
