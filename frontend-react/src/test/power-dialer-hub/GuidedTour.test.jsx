import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuidedTour } from '../../features/power-dialer-hub/GuidedTour';

// The tour's Next waits for the next step's target; press it only once it is enabled, and wait for the counter to move.
const pressNext = async (nextCounter) => {
  await waitFor(() => expect(screen.getByText('Next').closest('button')).toBeEnabled());
  fireEvent.click(screen.getByText('Next'));
  if (nextCounter) await screen.findByText(nextCounter);
};


const SEEN_KEY = 'alternate:power-dialer-tour-seen';

// Real Power Dialer targets aren't mounted in this test — stand-ins with the
// same data-tour attributes are enough to exercise positioning/step logic.
function renderWithTargets() {
  return render(
    <div>
      <div data-tour="current-call">Current call</div>
      <div data-tour="skip-reason">Skip reason</div>
      <div data-tour="add-note">Add note</div>
      <div data-tour="queue-list">Queue</div>
      <div data-tour="email-column">Email</div>
      <div data-tour="today-stats">Stats</div>
      <GuidedTour />
    </div>
  );
}

describe('GuidedTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows on first visit, pointing at the first available target', () => {
    renderWithTargets();
    expect(screen.getByText('Your queue, one lead at a time')).toBeInTheDocument();
    expect(screen.getByText('1 of 6')).toBeInTheDocument();
  });

  it('does not show again once marked seen', () => {
    window.localStorage.setItem(SEEN_KEY, '1');
    renderWithTargets();
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).not.toBeInTheDocument();
  });

  it('Next advances through steps and Skip tour marks it seen', () => {
    renderWithTargets();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Skip is always one click')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Skip tour'));
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('"Got it" on the final step closes and marks it seen', async () => {
    renderWithTargets();
    for (let i = 2; i <= 6; i++) await pressNext(`${i} of 6`);
    expect(screen.getByText('6 of 6')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('skips missing targets instead of getting stuck, and ends quietly if none remain', async () => {
    render(
      <div>
        <div data-tour="current-call">Current call</div>
        {/* every other target absent */}
        <GuidedTour />
      </div>
    );
    expect(screen.getByText('Your queue, one lead at a time')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    // nothing else on this page to point at: the tour ends after a short look (it waits a moment for each missing step)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /guided tour/i })).not.toBeInTheDocument(), { timeout: 12000 });
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
 }, 20000);
});
