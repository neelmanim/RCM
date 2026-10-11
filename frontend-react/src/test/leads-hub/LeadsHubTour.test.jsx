import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeadsHubTour } from '../../features/leads-hub/LeadsHubTour';

// The tour's Next waits for the next step's target; press it only once it is enabled, and wait for the counter to move.
const pressNext = async (nextCounter) => {
  await waitFor(() => expect(screen.getByText('Next').closest('button')).toBeEnabled());
  fireEvent.click(screen.getByText('Next'));
  if (nextCounter) await screen.findByText(nextCounter);
};


const SEEN_KEY = 'alternate:leads-hub-tour-seen-v2';

// Real Leads Hub targets aren't mounted in this test — stand-ins with the
// same data-tour attributes are enough to exercise positioning/step logic
// (same approach as power-dialer-hub/GuidedTour.test.jsx).
function renderWithTargets() {
  return render(
    <div>
      <div data-tour="company-group">Company group</div>
      <div data-tour="bulk-select">Select Leads</div>
      <div data-tour="saved-views">Saved views</div>
      <div data-tour="columns-menu">Columns</div>
      <div data-tour="switch-classic">Switch to classic view</div>
      <LeadsHubTour />
    </div>
  );
}

describe('LeadsHubTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows on first visit, pointing at the first available target', () => {
    renderWithTargets();
    expect(screen.getByText('Leads are grouped by company')).toBeInTheDocument();
    expect(screen.getByText('1 of 5')).toBeInTheDocument();
  });

  it('does not show again once marked seen', () => {
    window.localStorage.setItem(SEEN_KEY, '1');
    renderWithTargets();
    expect(screen.queryByRole('dialog', { name: /leads guided tour/i })).not.toBeInTheDocument();
  });

  it('Next advances through steps and Skip tour marks it seen', () => {
    renderWithTargets();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Select multiple leads at once')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Skip tour'));
    expect(screen.queryByRole('dialog', { name: /leads guided tour/i })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('"Got it" on the final step closes and marks it seen', async () => {
    renderWithTargets();
    for (let i = 2; i <= 5; i++) await pressNext(`${i} of 5`);
    expect(screen.getByText('5 of 5')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('skips missing targets instead of getting stuck, and ends quietly if none remain', async () => {
    render(
      <div>
        <div data-tour="company-group">Company group</div>
        {/* every other target absent */}
        <LeadsHubTour />
      </div>
    );
    expect(screen.getByText('Leads are grouped by company')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    // nothing else on this page to point at: the tour ends after a short look (it waits a moment for each missing step)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /leads guided tour/i })).not.toBeInTheDocument(), { timeout: 12000 });
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
 }, 20000);
});
