/**
 * Tests for js/utils.js — Pure helper functions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Import the functions under test ──────────────────────────────────────────
import {
    STATUS_BADGE,
    CALL_OUTCOME_ICON,
    statusBadgeClass,
    displayStatus,
    fmtDate,
    fmtDateTime,
    fmtRelativeTime,
    timeInStatus,
    fullName,
    ssoTag,
    showToast,
} from '../js/utils.js';


// ═══════════════════════════════════════════════════════════════════════════════
// statusBadgeClass
// ═══════════════════════════════════════════════════════════════════════════════
describe('statusBadgeClass', () => {
    it('returns correct class for Lead Assigned', () => {
        expect(statusBadgeClass('Lead Assigned')).toBe('badge-new');
    });

    it('returns correct class for Research', () => {
        expect(statusBadgeClass('Research')).toBe('badge-working');
    });

    it('returns correct class for Calling', () => {
        expect(statusBadgeClass('Calling')).toBe('badge-qualified');
    });

    it('returns correct class for Meeting Scheduled', () => {
        expect(statusBadgeClass('Meeting Scheduled')).toBe('badge-won');
    });

    it('returns correct class for Lead Unassigned', () => {
        expect(statusBadgeClass('Lead Unassigned')).toBe('badge-unassigned');
    });

    it('returns default badge-new for unknown status', () => {
        expect(statusBadgeClass('Unknown Status')).toBe('badge-new');
        expect(statusBadgeClass('')).toBe('badge-new');
    });

    it('returns correct class for Disqualified', () => {
        expect(statusBadgeClass('Disqualified')).toBe('badge-declined');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// displayStatus
// ═══════════════════════════════════════════════════════════════════════════════
describe('displayStatus', () => {
    it('returns original status when assigned_to is present', () => {
        const lead = { status: 'Lead Assigned', assigned_to: ['user-1'] };
        expect(displayStatus(lead)).toBe('Lead Assigned');
    });

    it('returns Lead Unassigned when status is Lead Assigned but no assignment', () => {
        expect(displayStatus({ status: 'Lead Assigned', assigned_to: [] })).toBe('Lead Unassigned');
        expect(displayStatus({ status: 'Lead Assigned' })).toBe('Lead Unassigned');
    });

    it('returns non-Lead-Assigned statuses unchanged', () => {
        expect(displayStatus({ status: 'Research' })).toBe('Research');
        expect(displayStatus({ status: 'Calling' })).toBe('Calling');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// fmtDate
// ═══════════════════════════════════════════════════════════════════════════════
describe('fmtDate', () => {
    it('returns — for null/undefined', () => {
        expect(fmtDate(null)).toBe('—');
        expect(fmtDate(undefined)).toBe('—');
        expect(fmtDate('')).toBe('—');
    });

    it('formats a valid ISO string', () => {
        const result = fmtDate('2026-01-15T10:30:00Z');
        expect(result).toMatch(/Jan/);
        expect(result).toMatch(/15/);
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// fmtDateTime
// ═══════════════════════════════════════════════════════════════════════════════
describe('fmtDateTime', () => {
    it('returns — for null/undefined', () => {
        expect(fmtDateTime(null)).toBe('—');
        expect(fmtDateTime(undefined)).toBe('—');
    });

    it('includes both date and time parts', () => {
        const result = fmtDateTime('2026-06-01T14:30:00Z');
        expect(result).toMatch(/Jun/);
        expect(result).toMatch(/1/);
        // Should include time (hour:minute)
        expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// fmtRelativeTime
// ═══════════════════════════════════════════════════════════════════════════════
describe('fmtRelativeTime', () => {
    it('returns Never for null/undefined', () => {
        expect(fmtRelativeTime(null)).toContain('Never');
        expect(fmtRelativeTime(undefined)).toContain('Never');
    });

    it('returns Just now for very recent timestamps', () => {
        const now = new Date().toISOString();
        expect(fmtRelativeTime(now)).toContain('Just now');
    });

    it('returns minutes ago for timestamps within an hour', () => {
        const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
        expect(fmtRelativeTime(tenMinAgo)).toContain('10m ago');
    });

    it('returns hours ago for timestamps within a day', () => {
        const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
        expect(fmtRelativeTime(threeHoursAgo)).toContain('3h ago');
    });

    it('returns days ago for timestamps within a week', () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
        expect(fmtRelativeTime(twoDaysAgo)).toContain('2d ago');
    });

    it('returns formatted date for timestamps older than a week', () => {
        const oldDate = new Date(Date.now() - 30 * 86400000).toISOString();
        const result = fmtRelativeTime(oldDate);
        // Should contain a slash-separated date like "1/15/2026"
        expect(result).toMatch(/\d/);
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// timeInStatus
// ═══════════════════════════════════════════════════════════════════════════════
describe('timeInStatus', () => {
    it('returns — for null/undefined', () => {
        expect(timeInStatus(null)).toBe('—');
        expect(timeInStatus(undefined)).toBe('—');
    });

    it('returns green color for < 1 hour', () => {
        const thirtyMinAgo = new Date(Date.now() - 30 * 60000).toISOString();
        const result = timeInStatus(thirtyMinAgo);
        expect(result).toContain('#22c55e');  // green
        expect(result).toContain('30m');
    });

    it('returns yellow color for 1-4 hours', () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
        const result = timeInStatus(twoHoursAgo);
        expect(result).toContain('#f59e0b');  // yellow
    });

    it('returns red color for > 4 hours', () => {
        const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
        const result = timeInStatus(fiveHoursAgo);
        expect(result).toContain('#ef4444');  // red
    });

    it('shows just now for very recent', () => {
        const justNow = new Date().toISOString();
        expect(timeInStatus(justNow)).toContain('just now');
    });

    it('shows days and hours for > 24h', () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
        const result = timeInStatus(twoDaysAgo);
        expect(result).toContain('2d');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// fullName
// ═══════════════════════════════════════════════════════════════════════════════
describe('fullName', () => {
    it('concatenates first and last name', () => {
        expect(fullName({ first_name: 'John', last_name: 'Doe' })).toBe('John Doe');
    });

    it('returns just first name if last is missing', () => {
        expect(fullName({ first_name: 'John' })).toBe('John');
    });

    it('returns just last name if first is missing', () => {
        expect(fullName({ last_name: 'Doe' })).toBe('Doe');
    });

    it('returns — when both names are missing', () => {
        expect(fullName({})).toBe('—');
        expect(fullName({ first_name: '', last_name: '' })).toBe('—');
    });

    it('falls back to the phone number for auto-created leads stuck with the "Unknown"/"Unknown Caller" placeholder', () => {
        expect(fullName({ last_name: 'Unknown', phone: '+19714095319' })).toBe('+19714095319');
        expect(fullName({ first_name: 'Unknown', last_name: 'Caller', phone: '+19714095319' })).toBe('+19714095319');
        expect(fullName({ last_name: 'Unknown' })).toBe('—'); // no phone at all — still the honest "nothing to show" case
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// ssoTag
// ═══════════════════════════════════════════════════════════════════════════════
describe('ssoTag', () => {
    it('returns Linked tag when true', () => {
        const result = ssoTag(true);
        expect(result).toContain('Linked');
        expect(result).toContain('✅');
    });

    it('returns Pending tag when false', () => {
        const result = ssoTag(false);
        expect(result).toContain('Pending');
        expect(result).toContain('⏳');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// showToast
// ═══════════════════════════════════════════════════════════════════════════════
describe('showToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('appends a toast element to the body', () => {
        showToast('Test message', 'success');
        const toasts = document.querySelectorAll('div[style*="position: fixed"]');
        expect(toasts.length).toBeGreaterThan(0);
    });

    it('includes the message text', () => {
        showToast('Something went wrong', 'error');
        expect(document.body.textContent).toContain('Something went wrong');
    });

    it('uses error theme by default', () => {
        showToast('Error!');
        expect(document.body.innerHTML).toContain('❌');
    });

    it('uses success theme when specified', () => {
        showToast('Done!', 'success');
        expect(document.body.innerHTML).toContain('✅');
    });

    it('uses info theme when specified', () => {
        showToast('Heads up', 'info');
        expect(document.body.innerHTML).toContain('ℹ️');
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════
describe('STATUS_BADGE constant', () => {
    it('has entries for all pipeline statuses', () => {
        expect(STATUS_BADGE).toHaveProperty('Lead Assigned');
        expect(STATUS_BADGE).toHaveProperty('Lead Unassigned');
        expect(STATUS_BADGE).toHaveProperty('Research');
        expect(STATUS_BADGE).toHaveProperty('Calling');
        expect(STATUS_BADGE).toHaveProperty('Meeting Scheduled');
        expect(STATUS_BADGE).toHaveProperty('Disqualified');
    });

    it('has legacy status entries for backward compatibility', () => {
        expect(STATUS_BADGE).toHaveProperty('Customer Declined');
        expect(STATUS_BADGE).toHaveProperty('Unreachable');
    });
});

describe('CALL_OUTCOME_ICON constant', () => {
    it('has SVG icons for all outcomes', () => {
        expect(CALL_OUTCOME_ICON).toHaveProperty('Call Completed');
        expect(CALL_OUTCOME_ICON).toHaveProperty('Left Voicemail');
        expect(CALL_OUTCOME_ICON).toHaveProperty('No Answer');
        expect(CALL_OUTCOME_ICON).toHaveProperty('Wrong Number');
        expect(CALL_OUTCOME_ICON).toHaveProperty('Callback Scheduled');
        // Each value should be an SVG string
        Object.values(CALL_OUTCOME_ICON).forEach(icon => {
            expect(icon).toContain('<svg');
        });
    });
});
