import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const summary = vi.fn();
vi.mock('../../services/api', () => ({ InstantlyInboxService: { summary: (...a) => summary(...a) } }));

import { OutboundRepliesCard } from '../../pages/OutboundRepliesCard';

const wait = { timeout: 3000 };
beforeEach(() => { summary.mockReset(); window._loadView = vi.fn(); });

describe('OutboundRepliesCard', () => {
  it('renders the 7-day summary and links to the Replies tab', async () => {
    summary.mockResolvedValue({ days: 7, replies: 14, positive: 3, reply_rate: 8.25, unread: 5, sent: 200 });
    render(<OutboundRepliesCard userRole="SDR" />);
    expect(await screen.findByText('14', {}, wait)).toBeInTheDocument();
    expect(screen.getByText('8.3%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Open Replies/ }));
    expect(window._loadView).toHaveBeenCalledWith('sales-tools', 'replies');
  });

  it('renders nothing on 403', async () => {
    summary.mockRejectedValue({ response: { status: 403 } });
    const { container } = render(<OutboundRepliesCard userRole="SDR" />);
    await vi.waitFor(() => expect(summary).toHaveBeenCalled(), wait);
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('never calls the API for CSM', async () => {
    const { container } = render(<OutboundRepliesCard userRole="CSM" />);
    expect(container).toBeEmptyDOMElement();
    await new Promise((r) => setTimeout(r, 1200));
    expect(summary).not.toHaveBeenCalled();
  });

  it('shows a quiet error line on other failures', async () => {
    summary.mockRejectedValue(new Error('x'));
    render(<OutboundRepliesCard userRole="AE" />);
    expect(await screen.findByText(/Couldn't load reply stats/, {}, wait)).toBeInTheDocument();
  });
});
