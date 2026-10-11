import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CadenceReadOnlyTour } from '../../features/sales-journey/CadenceReadOnlyTour';

// The tour's Next waits for the next step's target; press it only once it is enabled, and wait for the counter to move.
const pressNext = async (nextCounter) => {
  await waitFor(() => expect(screen.getByText('Next').closest('button')).toBeEnabled());
  fireEvent.click(screen.getByText('Next'));
  if (nextCounter) await screen.findByText(nextCounter);
};


const SEEN_KEY = 'alternate:cadence-rep-tour-seen-v2';

// Real Cadence targets aren't mounted in this test — stand-ins with the same
// data-tour attributes exercise positioning/step logic (same approach as
// sales-tools/SalesToolsTour.test.jsx).
function renderWithTargets() {
  return render(
    <div>
      <div data-tour="cadence-list-header">Sales Cadences</div>
      <div data-tour="cadence-readonly-banner">Read-only — contact your Pod Admin</div>
      <CadenceReadOnlyTour />
    </div>
  );
}

describe('CadenceReadOnlyTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows on first visit, pointing at the first available target', () => {
    renderWithTargets();
    expect(screen.getByText('Build your own cadences')).toBeInTheDocument();
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('does not show again once marked seen', () => {
    window.localStorage.setItem(SEEN_KEY, '1');
    renderWithTargets();
    expect(screen.queryByRole('dialog', { name: /cadence guided tour/i })).not.toBeInTheDocument();
  });

  it('"Got it" on the final step closes and marks it seen', async () => {
    renderWithTargets();
    await pressNext('2 of 2');
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('the list view alone (builder not open yet) shows the short version instead of getting stuck', async () => {
    render(
      <div>
        <div data-tour="cadence-list-header">Sales Cadences</div>
        {/* Builder's read-only banner isn't mounted until a cadence is opened */}
        <CadenceReadOnlyTour />
      </div>
    );
    expect(screen.getByText('Build your own cadences')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    // nothing else on this page to point at: the tour ends after a short look (it waits a moment for each missing step)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /cadence guided tour/i })).not.toBeInTheDocument(), { timeout: 12000 });
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
 }, 20000);
});
