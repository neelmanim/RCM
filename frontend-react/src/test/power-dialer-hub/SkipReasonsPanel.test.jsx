import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SkipReasonsPanel } from '../../features/power-dialer-hub/components/SkipReasonsPanel';
import { DialerService } from '../../services/api';

vi.mock('../../services/api', () => ({
  DialerService: { getSkipSummary: vi.fn() },
}));

describe('SkipReasonsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders reason and rep breakdowns from the summary endpoint', async () => {
    DialerService.getSkipSummary.mockResolvedValue({
      days: 7,
      total_skips: 3,
      dnc_skips: 1,
      by_reason: [{ reason: 'Wrong number', count: 2 }],
      by_rep: [{ user_id: 'rep-1', name: 'Rep One', count: 3 }],
    });
    render(<SkipReasonsPanel />);

    await waitFor(() => expect(screen.getByText('Wrong number')).toBeInTheDocument());
    expect(screen.getByText('Total skips').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('Do-not-contact skips').previousSibling).toHaveTextContent('1');
    expect(screen.getByText('Rep One')).toBeInTheDocument();
    expect(DialerService.getSkipSummary).toHaveBeenCalledWith(7);
  });

  it('re-fetches with the new window when the date range changes', async () => {
    DialerService.getSkipSummary.mockResolvedValue({
      total_skips: 0, dnc_skips: 0, by_reason: [], by_rep: [],
    });
    render(<SkipReasonsPanel />);
    await waitFor(() => expect(DialerService.getSkipSummary).toHaveBeenCalledWith(7));

    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Date range'), '30');
    await waitFor(() => expect(DialerService.getSkipSummary).toHaveBeenLastCalledWith(30));
  });

  it('shows an empty state when there are no skips with a reason', async () => {
    DialerService.getSkipSummary.mockResolvedValue({
      total_skips: 0, dnc_skips: 0, by_reason: [], by_rep: [],
    });
    render(<SkipReasonsPanel />);
    await waitFor(() => expect(screen.getByText(/No skips with a reason/)).toBeInTheDocument());
  });
});
