/**
 * Test for js/views/dialer_widget.js — hideDialerWidget() stale-closure race.
 *
 * RCA 2026-08-20 (prod, "dialer disappears on click"): hideDialerWidget()'s
 * 300ms fade-out setTimeout used to close over the module-level _widgetEl
 * variable directly. Clicking a second lead's Call button while the fade
 * was still pending created a NEW _widgetEl before the old timeout fired —
 * the stale timeout then read the variable's CURRENT value and removed the
 * NEW widget instead of the old one, orphaning it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../js/api.js', () => ({
    getCallStatus: vi.fn(),
    callAction: vi.fn(),
    disconnectCall: vi.fn(),
}));

vi.mock('../js/utils.js', () => ({
    showToast: vi.fn(),
}));

vi.mock('../js/auth.js', () => ({
    API_BASE: 'http://test',
    getAuthToken: () => null,
}));

const { showDialerWidget, hideDialerWidget } = await import('../js/views/dialer_widget.js');

describe('dialer_widget hideDialerWidget() stale-closure race', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not remove a newly-shown widget when an earlier fade-out timeout fires late', () => {
        showDialerWidget({ call_id: 'call-A' }, 'Lead A', '+1555000A');
        const widgetA = document.getElementById('dialer-widget');
        expect(widgetA).toBeTruthy();

        // Call A ends — starts the 300ms fade-out on widgetA.
        hideDialerWidget();

        // Before the fade-out fires, the SDR clicks Call on a second lead.
        // showDialerWidget() calls hideDialerWidget() again internally as
        // its own cleanup step, then creates a new widget element. widgetA
        // is still in the DOM at this point (its fade hasn't fired yet), so
        // getElementById() would ambiguously resolve to whichever of the two
        // same-id nodes comes first in document order — grab the freshly
        // appended one explicitly instead.
        vi.advanceTimersByTime(100);
        showDialerWidget({ call_id: 'call-B' }, 'Lead B', '+1555000B');
        const nodesAfterSecondShow = document.querySelectorAll('#dialer-widget');
        expect(nodesAfterSecondShow.length).toBe(2);
        const widgetB = nodesAfterSecondShow[nodesAfterSecondShow.length - 1];
        expect(widgetB).not.toBe(widgetA);

        // Let every pending fade-out timeout (including the stale one from
        // widgetA) run to completion.
        vi.advanceTimersByTime(300);

        const nodesAfterFade = document.querySelectorAll('#dialer-widget');
        expect(nodesAfterFade.length).toBe(1);
        expect(nodesAfterFade[0]).toBe(widgetB);
        expect(document.body.contains(widgetA)).toBe(false);
    });
});
