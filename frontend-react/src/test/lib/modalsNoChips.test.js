import { describe, it, expect, vi } from 'vitest';

// modals.js is the legacy shell's call-outcome modal; only its pure chip renderer is under test.
vi.mock('../../../../frontend/js/auth.js', () => ({ currentUser: {} }));
vi.mock('../../../../frontend/js/api.js', () => Object.fromEntries(
  ['logCall', 'createUser', 'createLead', 'markNoShow', 'fetchCallOutcomes', 'fetchCallOutcomeStatus', 'createDisqualifyRequest',
    'getEmailStatus', 'getCalendarAvailability', 'draftMeetingAgenda', 'updateLeadStatus', 'addDiscoveryMeeting'].map((n) => [n, vi.fn()]),
));
vi.mock('../../../../frontend/js/utils.js', () => ({ showToast: vi.fn() }));
vi.mock('../../../../frontend/js/mp.js', () => ({ mp: { track: vi.fn() } }));

import { _renderNoChips } from '../../../../frontend/js/views/modals.js';

const OUTCOMES = [
  { value: 'No Answer', group: 'not_answered' },
  { value: 'Left Voicemail', group: 'not_answered' },
  { value: 'Wrong Number', group: 'terminal' },
  { value: 'Not Interested', group: 'terminal' },
];

describe('call outcome modal — "No / Voicemail" branch', () => {
  it('offers Wrong Number (AE: "where do I mark wrong number?") but not unrelated terminal outcomes', () => {
    const html = _renderNoChips(OUTCOMES);
    expect(html).toContain('data-value="Wrong Number"');
    expect(html).toContain('data-value="No Answer"');
    expect(html).not.toContain('data-value="Not Interested"');
  });

  it('still offers it when the outcome list has not loaded and the fallback chips are used', () => {
    expect(_renderNoChips([])).toContain('data-value="Wrong Number"');
  });

  it('respects an admin having disabled the outcome', () => {
    expect(_renderNoChips(OUTCOMES.filter((o) => o.value !== 'Wrong Number'))).not.toContain('Wrong Number');
  });
});
