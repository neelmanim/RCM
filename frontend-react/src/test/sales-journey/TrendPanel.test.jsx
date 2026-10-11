import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendPanel } from '../../features/sales-journey/TrendPanel';

const getStatsTrend = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    getStatsTrend: (...args) => getStatsTrend(...args),
  },
}));

beforeEach(() => {
  getStatsTrend.mockReset();
});

describe('TrendPanel', () => {
  it('renders nothing when there are no points yet', async () => {
    getStatsTrend.mockResolvedValue({ bucket: 'week', points: [] });
    const { container } = render(<TrendPanel journeyId="j1" />);
    await Promise.resolve();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per week with sent count and open rate', async () => {
    getStatsTrend.mockResolvedValue({
      bucket: 'week',
      points: [
        { period: '2026-09-01T00:00:00Z', sent: 10, opened: 5, open_rate: 0.5 },
        { period: '2026-09-08T00:00:00Z', sent: 8, opened: 6, open_rate: 0.75 },
      ],
    });
    render(<TrendPanel journeyId="j1" />);

    await screen.findByText('Weekly trend');
    expect(screen.getByText('10 sent · 50% open')).toBeInTheDocument();
    expect(screen.getByText('8 sent · 75% open')).toBeInTheDocument();
  });
});
