import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../features/sales-journey/SalesJourneyHub', () => ({ SalesJourneyHub: ({ openJourneyId }) => <div data-testid="journey" data-open={openJourneyId ?? ''} /> }));
vi.mock('../../features/sales-tools/CampaignsSection', () => ({ CampaignsSection: () => null }));
vi.mock('../../features/sales-tools/SmsCampaignsSection', () => ({ SmsCampaignsSection: () => null }));
vi.mock('../../features/sales-tools/SalesToolsTour', () => ({ SalesToolsTour: () => null }));
vi.mock('../../features/sales-tools/replies/RepliesSection', () => ({ RepliesSection: () => <div>replies-section</div> }));

import { SalesToolsHub } from '../../features/sales-tools/SalesToolsHub';

describe('SalesToolsHub — Replies tab gating', () => {
  it.each(['Super Admin', 'Pod Admin', 'SDR', 'AE'])('shows the tab for %s', (role) => {
    render(<SalesToolsHub userRole={role} />);
    expect(screen.getByRole('button', { name: 'Replies' })).toBeInTheDocument();
  });

  it.each(['CSM', '', 'Intern'])('hides the tab for %j', (role) => {
    render(<SalesToolsHub userRole={role} />);
    expect(screen.queryByRole('button', { name: 'Replies' })).not.toBeInTheDocument();
  });

  it('#sales-tools/replies opens the Replies tab and is not treated as a cadence id', () => {
    render(<SalesToolsHub userRole="SDR" journeyId="replies" />);
    expect(screen.getByText('replies-section')).toBeInTheDocument();
    expect(screen.getByTestId('journey').dataset.open).toBe('');
  });

  it('the replies deep link does nothing for a CSM', () => {
    render(<SalesToolsHub userRole="CSM" journeyId="replies" />);
    expect(screen.queryByText('replies-section')).not.toBeInTheDocument();
  });
});
