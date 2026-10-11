import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountDetailTour } from '../../features/csm-portal/AccountDetailTour';

// The tour's Next waits for the next step's target; press it only once it is enabled, and wait for the counter to move.
const pressNext = async (nextCounter) => {
  await waitFor(() => expect(screen.getByText('Next').closest('button')).toBeEnabled());
  fireEvent.click(screen.getByText('Next'));
  if (nextCounter) await screen.findByText(nextCounter);
};


const SEEN_KEY = 'alternate:csm-account-360-tour-seen';

// Split out of CsmPortalTour (2026-09-16) — Account 360 is reached from any
// of the 4 flat sections, so it needs its own seenKey independent of them.
function renderWithTargets() {
  return render(
    <div>
      <div data-tour="csm-portal-account-actions">Log touch / Champion departed / Override / New renewal opp</div>
      <div data-tour="csm-portal-call-log">Call history + Log a call</div>
      <AccountDetailTour />
    </div>
  );
}

describe('AccountDetailTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows on first visit to an account, covering actions then the new call-log form', async () => {
    renderWithTargets();
    expect(screen.getByText('Account 360 actions')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await pressNext('2 of 2');
    expect(screen.getByText('Log a call')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('does not show again once marked seen', () => {
    window.localStorage.setItem(SEEN_KEY, '1');
    renderWithTargets();
    expect(screen.queryByRole('dialog', { name: /account 360 guided tour/i })).not.toBeInTheDocument();
  });

  it('uses its own seenKey, independent of any section tour', () => {
    window.localStorage.setItem('alternate:csm-portal-inbox-tour-seen', '1');
    renderWithTargets();
    expect(screen.getByText('Account 360 actions')).toBeInTheDocument();
  });
});
