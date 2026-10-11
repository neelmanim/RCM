import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SalesToolsTour } from '../../features/sales-tools/SalesToolsTour';

// The tour's Next waits for the next step's target; press it only once it is enabled, and wait for the counter to move.
const pressNext = async (nextCounter) => {
  await waitFor(() => expect(screen.getByText('Next').closest('button')).toBeEnabled());
  fireEvent.click(screen.getByText('Next'));
  if (nextCounter) await screen.findByText(nextCounter);
};


const SEEN_KEY = 'alternate:sales-tools-tour-seen';

// Real Sales Tools targets aren't mounted in this test — stand-ins with the
// same data-tour attributes exercise positioning/step logic (same approach
// as leads-hub/LeadsHubTour.test.jsx).
function renderWithTargets() {
  return render(
    <div>
      <div data-tour="sales-tools-section-tabs">Cadence / Campaigns</div>
      <div data-tour="cadence-list-header">Sales Cadences</div>
      <div data-tour="new-campaign-button">New Campaign</div>
      <div data-tour="campaigns-subtabs">Campaigns / Performance / Templates</div>
      <div data-tour="campaigns-status-filter">All statuses</div>
      <SalesToolsTour />
    </div>
  );
}

describe('SalesToolsTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows on first visit, pointing at the first available target', () => {
    renderWithTargets();
    expect(screen.getByText('Everything you send, in one place')).toBeInTheDocument();
    expect(screen.getByText('1 of 5')).toBeInTheDocument();
  });

  it('does not show again once marked seen', () => {
    window.localStorage.setItem(SEEN_KEY, '1');
    renderWithTargets();
    expect(screen.queryByRole('dialog', { name: /sales tools guided tour/i })).not.toBeInTheDocument();
  });

  it('"Got it" on the final step closes and marks it seen', async () => {
    renderWithTargets();
    for (let i = 2; i <= 5; i++) await pressNext(`${i} of 5`);
    expect(screen.getByText('5 of 5')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
  });

  it('a Cadence-default view (only step 1 mounted) shows the short version instead of getting stuck', async () => {
    render(
      <div>
        <div data-tour="sales-tools-section-tabs">Cadence / Campaigns</div>
        {/* Campaigns tab not active yet — its steps' targets aren't mounted */}
        <SalesToolsTour />
      </div>
    );
    expect(screen.getByText('Everything you send, in one place')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    // nothing else on this page to point at: the tour ends after a short look (it waits a moment for each missing step)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /sales tools guided tour/i })).not.toBeInTheDocument(), { timeout: 12000 });
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('1');
 }, 20000);
});
