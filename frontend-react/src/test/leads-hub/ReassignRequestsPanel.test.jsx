import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReassignRequestsPanel } from '../../features/leads-hub/components/ReassignRequestsPanel';

const requests = [{
  id: 'q1', lead_id: 'l1', lead_name: 'Akash Chaudhary', company: 'AIMS Hospital', lead_status: 'Calling',
  current_owner: 'Tanya Batra', requested_by_name: 'Ankit Bakshi', note: 'my account', requested_at: '2026-10-07T00:00:00Z',
}];

vi.mock('../../services/api', () => ({
  ReassignService: {
    getRequests: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  },
}));
import { ReassignService } from '../../services/api';

beforeEach(() => {
  vi.clearAllMocks();
  ReassignService.getRequests.mockResolvedValue({ requests });
  ReassignService.approve.mockResolvedValue({ message: 'Akash Chaudhary reassigned to Ankit Bakshi' });
  ReassignService.reject.mockResolvedValue({ message: 'Request rejected' });
});

describe('ReassignRequestsPanel', () => {
  it('shows who asked, who owns the lead now, and the note', async () => {
    render(<ReassignRequestsPanel onToast={vi.fn()} />);
    expect(await screen.findByText('Akash Chaudhary')).toBeInTheDocument();
    expect(screen.getByText('AIMS Hospital')).toBeInTheDocument();
    expect(screen.getByText('Tanya Batra')).toBeInTheDocument();
    expect(screen.getByText('Ankit Bakshi')).toBeInTheDocument();
    expect(screen.getByText('my account')).toBeInTheDocument();
  });

  it('Approve calls the API, toasts the server message and reloads the list', async () => {
    const onToast = vi.fn();
    render(<ReassignRequestsPanel onToast={onToast} />);
    await userEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(ReassignService.approve).toHaveBeenCalledWith('q1'));
    expect(onToast).toHaveBeenCalledWith('Akash Chaudhary reassigned to Ankit Bakshi');
    await waitFor(() => expect(ReassignService.getRequests).toHaveBeenCalledTimes(2));
  });

  it('Reject asks for an optional reason, then sends it', async () => {
    const onToast = vi.fn();
    render(<ReassignRequestsPanel onToast={onToast} />);
    await userEvent.click(await screen.findByText('Reject'));
    await userEvent.type(screen.getByLabelText('Rejection reason'), 'Tanya is still working it');
    await userEvent.click(screen.getByText('Confirm reject'));
    await waitFor(() => expect(ReassignService.reject).toHaveBeenCalledWith('q1', 'Tanya is still working it'));
    expect(onToast).toHaveBeenCalledWith('Request rejected');
  });

  it('a failed approve (already reviewed) shows the server reason and refreshes', async () => {
    ReassignService.approve.mockRejectedValue({ response: { data: { detail: 'Request already approved' } } });
    const onToast = vi.fn();
    render(<ReassignRequestsPanel onToast={onToast} />);
    await userEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Request already approved'));
    await waitFor(() => expect(ReassignService.getRequests).toHaveBeenCalledTimes(2));
  });

  it('shows an empty state and a load error', async () => {
    ReassignService.getRequests.mockResolvedValueOnce({ requests: [] });
    const { unmount } = render(<ReassignRequestsPanel onToast={vi.fn()} />);
    expect(await screen.findByText('No pending reassign requests.')).toBeInTheDocument();
    unmount();
    ReassignService.getRequests.mockRejectedValueOnce({ response: { data: { detail: 'boom' } } });
    render(<ReassignRequestsPanel onToast={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load reassign requests: boom/)).toBeInTheDocument();
  });
});
