import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RepPerformanceTable } from '../../features/sales-journey/RepPerformanceTable';

const getStatsByRep = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    getStatsByRep: (...args) => getStatsByRep(...args),
  },
}));

beforeEach(() => {
  getStatsByRep.mockReset();
});

describe('RepPerformanceTable', () => {
  it('renders nothing when there is no rep data yet', async () => {
    getStatsByRep.mockResolvedValue({ reps: [] });
    const { container } = render(<RepPerformanceTable journeyId="j1" />);
    await Promise.resolve();
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a row per rep, already sorted by the backend', async () => {
    getStatsByRep.mockResolvedValue({
      reps: [
        { user_id: 'u1', name: 'Priya Shah', sent: 10, opened: 6, clicked: 2, replied: 3, open_rate: 0.6, click_rate: 0.2, reply_rate: 0.3 },
        { user_id: 'u2', name: 'Rahul Verma', sent: 8, opened: 2, clicked: 0, replied: 1, open_rate: 0.25, click_rate: 0, reply_rate: 0.125 },
      ],
    });
    render(<RepPerformanceTable journeyId="j1" />);

    await screen.findByText('Rep performance');
    expect(screen.getByText('Priya Shah')).toBeInTheDocument();
    expect(screen.getByText('Rahul Verma')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('13%')).toBeInTheDocument(); // Math.round(0.125 * 100)
  });
});
