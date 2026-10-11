import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CsmPortalTour } from '../../features/csm-portal/CsmPortalTour';

// The tour's Next waits for the next step's target; press it only once it is enabled, and wait for the counter to move.
const pressNext = async (nextCounter) => {
  await waitFor(() => expect(screen.getByText('Next').closest('button')).toBeEnabled());
  fireEvent.click(screen.getByText('Next'));
  if (nextCounter) await screen.findByText(nextCounter);
};


// 2026-09-16: split section-aware after the nav restructuring (see the
// component's own doc comment) — a CSM's own flat nav items each get a
// short, always-complete 2-step tour with their own seenKey; the
// Super-Admin-only merged Pipeline hub (no `section`) keeps the original
// single continuous 6-step tour. Stand-in targets, same approach as
// SalesToolsTour.test.jsx.
function renderFlat(section, targets) {
  return render(
    <div>
      <div data-tour="csm-portal-header">Inbox</div>
      {targets}
      <CsmPortalTour section={section} />
    </div>
  );
}

describe('CsmPortalTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('flat mode: a CSM\'s Inbox page gets its own 2-step tour ending cleanly', async () => {
    renderFlat('inbox', <div data-tour="csm-portal-time-saved">Time saved banner</div>);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await pressNext('2 of 2');
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem('alternate:csm-portal-inbox-tour-seen')).toBe('1');
  });

  it('flat mode: each section has its own independent seenKey, not a shared one', () => {
    window.localStorage.setItem('alternate:csm-portal-inbox-tour-seen', '1');
    renderFlat('portfolio', <div data-tour="csm-portal-portfolio-table">Portfolio table</div>);
    // Portfolio's own tour hasn't been marked seen, even though Inbox's has.
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('flat mode: does not show again once that section is marked seen', () => {
    window.localStorage.setItem('alternate:csm-portal-playbooks-tour-seen', '1');
    renderFlat('playbooks', <div data-tour="csm-portal-playbooks">Playbooks</div>);
    expect(screen.queryByRole('dialog', { name: /csm portal guided tour/i })).not.toBeInTheDocument();
  });

  it('admin mode (no section): one continuous 6-step tour, shared seenKey', async () => {
    render(
      <div>
        <div data-tour="csm-portal-header">CSM Portal</div>
        <div data-tour="csm-portal-tabs">Inbox / Portfolio / Playbooks / Digest</div>
        <div data-tour="csm-portal-time-saved">Time saved banner</div>
        <div data-tour="csm-portal-portfolio-table">Portfolio table</div>
        <div data-tour="csm-portal-playbooks">Playbooks</div>
        <div data-tour="csm-portal-digest">Digest</div>
        <CsmPortalTour />
      </div>
    );
    expect(screen.getByText('1 of 6')).toBeInTheDocument();
    for (let i = 2; i <= 6; i++) await pressNext(`${i} of 6`);
    fireEvent.click(screen.getByText('Got it'));
    expect(window.localStorage.getItem('alternate:csm-portal-tour-seen')).toBe('1');
  });
});
