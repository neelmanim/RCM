import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeaderboardHub } from '../../features/leaderboard/LeaderboardHub';
import { LeaderboardService } from '../../services/api';

vi.mock('../../services/api', () => ({
  LeaderboardService: { getSdrs: vi.fn(), getAes: vi.fn() },
}));

const person = (over = {}) => ({
  id: 'u1', name: 'Asha Rao', email: 'asha@test.com', pod_name: 'Alpha',
  calls_today: 3, total_calls: 40, meetings_scheduled: 9,
  disqualified: 2, total_leads: 60, conversion_rate: 15, rank: 1, ...over,
});

const FOUR = [
  person(),
  person({ id: 'u2', name: 'Bilal Khan', rank: 2, meetings_scheduled: 7, conversion_rate: 25 }),
  person({ id: 'u3', name: 'Chen Wei', rank: 3, meetings_scheduled: 5, conversion_rate: 8 }),
  person({ id: 'u4', name: 'Dara Singh', rank: 4, meetings_scheduled: 1 }),
];

describe('LeaderboardHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    LeaderboardService.getSdrs.mockResolvedValue(FOUR);
    LeaderboardService.getAes.mockResolvedValue([person({ id: 'a1', name: 'AE One' })]);
    sessionStorage.clear();
  });

  it('shows a podium for the top three and the full table for everyone', async () => {
    render(<LeaderboardHub userRole="Super Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0));

    // Top 3 appear twice (podium + table); the 4th only in the table.
    expect(screen.getAllByText('Asha Rao')).toHaveLength(2);
    expect(screen.getAllByText('Dara Singh')).toHaveLength(1);
  });

  it('marks the viewer with a You badge', async () => {
    render(<LeaderboardHub userRole="Super Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(screen.getAllByText('You').length).toBeGreaterThan(0));
  });

  it('re-fetches for a different range', async () => {
    render(<LeaderboardHub userRole="Super Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(LeaderboardService.getSdrs).toHaveBeenCalledWith(0, false));

    await userEvent.click(screen.getByRole('button', { name: '30 Days' }));
    await waitFor(() => expect(LeaderboardService.getSdrs).toHaveBeenCalledWith(30, false));
  });

  it('gives admins both boards and switches to the AE endpoint', async () => {
    render(<LeaderboardHub userRole="Super Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(LeaderboardService.getSdrs).toHaveBeenCalled());

    await userEvent.click(screen.getByText('AEs'));
    await waitFor(() => expect(LeaderboardService.getAes).toHaveBeenCalled());
    expect(screen.getAllByText('AE One').length).toBeGreaterThan(0);
  });

  it('hides the board tabs from a non-admin', async () => {
    render(<LeaderboardHub userRole="SDR" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(LeaderboardService.getSdrs).toHaveBeenCalled());
    expect(screen.queryByText('AEs')).not.toBeInTheDocument();
  });

  it('pins an AE to the AE board without offering a choice', async () => {
    render(<LeaderboardHub userRole="AE" userId="a1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(LeaderboardService.getAes).toHaveBeenCalled());
    expect(LeaderboardService.getSdrs).not.toHaveBeenCalled();
    expect(screen.queryByText('SDRs')).not.toBeInTheDocument();
  });

  it('gives a Pod Admin a scope toggle that defaults to their pod and persists', async () => {
    render(<LeaderboardHub userRole="Pod Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(LeaderboardService.getSdrs).toHaveBeenCalledWith(0, false));

    await userEvent.click(screen.getByRole('button', { name: /Global/ }));
    await waitFor(() => expect(LeaderboardService.getSdrs).toHaveBeenCalledWith(0, true));
    // Same sessionStorage key the legacy page used, so the choice carries over.
    expect(JSON.parse(sessionStorage.getItem('leaderboard_view_state')).globalView).toBe(true);
  });

  it('does not offer the scope toggle to a Super Admin', async () => {
    render(<LeaderboardHub userRole="Super Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(LeaderboardService.getSdrs).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /My Pod/ })).not.toBeInTheDocument();
  });

  it('lets an admin open anyone’s performance page', async () => {
    const onOpenPerson = vi.fn();
    render(<LeaderboardHub userRole="Super Admin" userId="u9" onOpenPerson={onOpenPerson} />);
    await waitFor(() => expect(screen.getAllByText('Bilal Khan').length).toBeGreaterThan(0));

    await userEvent.click(screen.getAllByText('Bilal Khan')[0]);
    expect(onOpenPerson).toHaveBeenCalledWith('u2');
  });

  it('lets an SDR open only their own, not a colleague’s', async () => {
    const onOpenPerson = vi.fn();
    render(<LeaderboardHub userRole="SDR" userId="u1" onOpenPerson={onOpenPerson} />);
    await waitFor(() => expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0));

    // Their own name is a button…
    await userEvent.click(screen.getAllByText('Asha Rao')[0]);
    expect(onOpenPerson).toHaveBeenCalledWith('u1');

    // …a colleague's is inert, with the reason on hover.
    onOpenPerson.mockClear();
    await userEvent.click(screen.getAllByText('Bilal Khan')[0]);
    expect(onOpenPerson).not.toHaveBeenCalled();
  });

  it('explains an empty pod-scoped board differently from an empty org', async () => {
    LeaderboardService.getSdrs.mockResolvedValue([]);
    const { unmount } = render(<LeaderboardHub userRole="Pod Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Switch to Global/i)).toBeInTheDocument());
    unmount();

    render(<LeaderboardHub userRole="Super Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Add SDRs to start tracking/i)).toBeInTheDocument());
  });

  it('renders an empty board rather than crashing when the request fails', async () => {
    LeaderboardService.getSdrs.mockRejectedValue(new Error('boom'));
    render(<LeaderboardHub userRole="Super Admin" userId="u1" onOpenPerson={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No SDRs to rank yet/i)).toBeInTheDocument());
  });
});
