import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JourneyList } from '../../features/sales-journey/JourneyList';
import { SalesJourneyService } from '../../services/api';

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    list: vi.fn(),
    create: vi.fn(),
    getStats: vi.fn(),
    archive: vi.fn(),
  },
  PodsService: {
    getAll: vi.fn(() => Promise.resolve([])),
  },
}));

const journeys = [
  { id: 'j1', name: 'Onboarding Drip', status: 'draft', owner_id: 'u1' },
  { id: 'j2', name: 'Re-engagement', status: 'active', owner_id: 'u1' },
  { id: 'j3', name: 'Win-back', status: 'archived', owner_id: 'u1' },
];

describe('JourneyList — filter, pagination, delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SalesJourneyService.list.mockResolvedValue(journeys);
    SalesJourneyService.getStats.mockResolvedValue({ active: 0 });
    SalesJourneyService.archive.mockResolvedValue({ id: 'j1', status: 'archived', enrollments_exited: 0 });
  });

  it('filters by name search', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.type(screen.getByPlaceholderText('Search cadences by name…'), 'win');
    expect(screen.queryByText('Onboarding Drip')).not.toBeInTheDocument();
    expect(screen.getByText('Win-back')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.selectOptions(screen.getByDisplayValue('All statuses'), 'active');
    expect(screen.queryByText('Onboarding Drip')).not.toBeInTheDocument();
    expect(screen.getByText('Re-engagement')).toBeInTheDocument();
  });

  it('paginates when there are more than 10 cadences', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `j${i}`, name: `Cadence ${i}`, status: 'draft', owner_id: 'u1',
    }));
    SalesJourneyService.list.mockResolvedValue(many);
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Cadence 0'));

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Cadence 10')).not.toBeInTheDocument();
  });

  it('deletes a single cadence after confirming, warning about active enrollments', async () => {
    SalesJourneyService.getStats.mockResolvedValue({ active: 3 });
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getAllByTitle('Delete cadence')[0]);
    await waitFor(() => screen.getByText(/currently enrolled will be exited/));
    expect(screen.getByText(/3 lead\(s\)/)).toBeInTheDocument();

    await user.click(screen.getByText('Delete'));
    await waitFor(() => expect(SalesJourneyService.archive).toHaveBeenCalledWith('j1', 3));
  });

  it('bulk-deletes selected cadences', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getByLabelText('Select Onboarding Drip'));
    await user.click(screen.getByLabelText('Select Re-engagement'));
    await user.click(screen.getByText('Delete 2 selected'));

    await waitFor(() => screen.getByText('Delete 2 cadences?'));
    await user.click(screen.getByText('Delete'));

    await waitFor(() => expect(SalesJourneyService.archive).toHaveBeenCalledTimes(2));
  });

  it('drops a selection once its cadence is filtered out, so bulk delete cannot silently include it', async () => {
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getByLabelText('Select Onboarding Drip'));
    expect(screen.getByText('Delete 1 selected')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search cadences by name…'), 'win');
    await waitFor(() => expect(screen.queryByText('Delete 1 selected')).not.toBeInTheDocument());
  });

  it('reflects partial bulk-delete failure — refreshes the list and keeps only the failed cadence selected for retry', async () => {
    SalesJourneyService.archive.mockImplementation((id) =>
      id === 'j2' ? Promise.reject(new Error('boom')) : Promise.resolve({ id, status: 'archived', enrollments_exited: 0 })
    );
    const user = userEvent.setup();
    render(<JourneyList onOpen={() => {}} />);
    await waitFor(() => screen.getByText('Onboarding Drip'));

    await user.click(screen.getByLabelText('Select Onboarding Drip'));
    await user.click(screen.getByLabelText('Select Re-engagement'));
    await user.click(screen.getByText('Delete 2 selected'));
    await waitFor(() => screen.getByText('Delete 2 cadences?'));
    await user.click(screen.getByText('Delete'));

    await waitFor(() => expect(SalesJourneyService.archive).toHaveBeenCalledTimes(2));
    // Both attempted, list refreshed regardless of the partial failure —
    // not left showing stale pre-delete state.
    expect(SalesJourneyService.list).toHaveBeenCalledTimes(2); // initial load + post-delete reload
    await waitFor(() => screen.getByText(/Failed to delete 1 cadence/));
    expect(screen.getByText('Delete 1 selected')).toBeInTheDocument();
  });
});
