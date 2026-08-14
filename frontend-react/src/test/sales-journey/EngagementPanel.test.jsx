import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EngagementPanel } from '../../features/sales-journey/EngagementPanel';

const getStats = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    getStats: (...args) => getStats(...args),
  },
}));

const NODES = [
  { id: 'n1', type: 'trigger', data: {} },
  { id: 'n2', type: 'email', data: {} },
];

beforeEach(() => {
  getStats.mockClear();
});

describe('EngagementPanel', () => {
  it('renders nothing while loading or when nothing has been sent yet', async () => {
    getStats.mockResolvedValue({ engagement: { overall: { sent: 0, opened: 0, clicked: 0, replied: 0, open_rate: 0, click_rate: 0, reply_rate: 0 }, by_step: {} } });
    const { container } = render(<EngagementPanel journeyId="j1" nodes={NODES} />);
    await waitFor(() => expect(getStats).toHaveBeenCalledWith('j1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows overall open/click/reply rates once emails have been sent', async () => {
    getStats.mockResolvedValue({
      engagement: {
        overall: { sent: 10, opened: 5, clicked: 2, replied: 3, open_rate: 0.5, click_rate: 0.2, reply_rate: 0.3 },
        by_step: { n2: { sent: 10, opened: 5, clicked: 2, replied: 3, open_rate: 0.5, click_rate: 0.2, reply_rate: 0.3 } },
      },
    });
    render(<EngagementPanel journeyId="j1" nodes={NODES} />);

    await screen.findByText('Engagement');
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('(50%)')).toBeInTheDocument();
    expect(screen.getByText('10 sent total')).toBeInTheDocument();
  });

  it('shows a per-step breakdown table when there is more than one email step', async () => {
    getStats.mockResolvedValue({
      engagement: {
        overall: { sent: 10, opened: 5, clicked: 2, replied: 3, open_rate: 0.5, click_rate: 0.2, reply_rate: 0.3 },
        by_step: {
          n2: { sent: 6, opened: 3, clicked: 1, replied: 2, open_rate: 0.5, click_rate: 0.167, reply_rate: 0.33 },
          n3: { sent: 4, opened: 2, clicked: 1, replied: 1, open_rate: 0.5, click_rate: 0.25, reply_rate: 0.25 },
        },
      },
    });
    const nodes = [...NODES, { id: 'n3', type: 'email', data: {} }];
    render(<EngagementPanel journeyId="j1" nodes={nodes} />);

    await screen.findByText('Step');
    expect(screen.getByText('Email #1')).toBeInTheDocument();
    expect(screen.getByText('Email #2')).toBeInTheDocument();
  });

  it('shows a per-variant breakdown table even with only a single email step', async () => {
    getStats.mockResolvedValue({
      engagement: {
        overall: { sent: 10, opened: 6, clicked: 2, replied: 1, open_rate: 0.6, click_rate: 0.2, reply_rate: 0.1 },
        by_step: {
          n2: {
            sent: 10, opened: 6, clicked: 2, replied: 1, open_rate: 0.6, click_rate: 0.2, reply_rate: 0.1,
            by_variant: {
              A: { sent: 5, opened: 4, clicked: 1, replied: 1, open_rate: 0.8, click_rate: 0.2, reply_rate: 0.2 },
              B: { sent: 5, opened: 2, clicked: 1, replied: 0, open_rate: 0.4, click_rate: 0.2, reply_rate: 0 },
            },
          },
        },
      },
    });
    render(<EngagementPanel journeyId="j1" nodes={NODES} />);

    await screen.findByText('Step');
    expect(screen.getByText('↳ Variant A')).toBeInTheDocument();
    expect(screen.getByText('↳ Variant B')).toBeInTheDocument();
  });
});
