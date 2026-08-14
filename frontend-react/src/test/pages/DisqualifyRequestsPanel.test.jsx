import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisqualifyRequestsPanel } from '../../features/leads-hub/components/DisqualifyRequestsPanel';

const requests = [
  { id: 'r1', company: 'Acme', lead_ids: ['l1'], reason: 'Wrong number', requested_by_name: 'Nishita Saraf', requested_at: '2026-07-21T00:00:00Z' },
  { id: 'r2', company: 'Globex', lead_ids: ['l2', 'l3'], reason: 'On maternity leave', requested_by_name: 'Nishant Choudhary', requested_at: '2026-07-20T00:00:00Z' },
];

vi.mock('../../services/api', () => ({
  DisqualifyService: {
    getRequests: vi.fn(() => Promise.resolve({ requests })),
    approve: vi.fn(() => Promise.resolve({ message: 'Approved' })),
    reject: vi.fn(() => Promise.resolve({ message: 'Rejected' })),
  },
}));

import { DisqualifyService } from '../../services/api';

describe('DisqualifyRequestsPanel — bulk actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selecting multiple requests and clicking Approve all approves each one', async () => {
    const user = userEvent.setup();
    render(<DisqualifyRequestsPanel onToast={() => {}} />);

    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());

    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is "select all"; the rest are per-row.
    await user.click(checkboxes[1]);
    await user.click(checkboxes[2]);

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByText('Approve all'));

    // Native window.confirm replaced with the app's own ConfirmDialog.
    const dialog = (await screen.findByRole('heading', { name: 'Approve requests' })).parentElement.parentElement;
    await user.click(within(dialog).getByText('Approve'));

    await waitFor(() => {
      expect(DisqualifyService.approve).toHaveBeenCalledWith('r1');
      expect(DisqualifyService.approve).toHaveBeenCalledWith('r2');
    });
    expect(DisqualifyService.approve).toHaveBeenCalledTimes(2);
  });

  it('the Reason column wraps long text instead of overflowing into other columns', async () => {
    render(<DisqualifyRequestsPanel onToast={() => {}} />);
    await waitFor(() => expect(screen.getByText('Wrong number')).toBeInTheDocument());
    // RCA 2026-07-28: TableCell's default whitespace-nowrap was winning over
    // this cell's whitespace-normal override (Tailwind resolves conflicting
    // utilities by stylesheet order, not className string order) — confirm
    // the override actually applies now.
    const cell = screen.getByText('Wrong number');
    expect(cell.className).toContain('whitespace-normal');
    expect(cell.className).not.toMatch(/\bwhitespace-nowrap\b/);
  });
});
