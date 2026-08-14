import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityPanel } from '../../features/sales-journey/ActivityPanel';

const getActivity = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    getActivity: (...args) => getActivity(...args),
  },
}));

beforeEach(() => {
  getActivity.mockClear();
});

describe('ActivityPanel', () => {
  it('does not fetch until opened', () => {
    render(<ActivityPanel journeyId="j1" />);
    expect(getActivity).not.toHaveBeenCalled();
  });

  it('shows an empty state when there is no activity', async () => {
    getActivity.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ActivityPanel journeyId="j1" />);

    await user.click(screen.getByText('Activity'));
    await screen.findByText('No activity yet.');
  });

  it('renders a mixed email/sms timeline', async () => {
    getActivity.mockResolvedValue([
      { type: 'sms_sent', at: '2026-08-13T12:00:00Z', lead_id: 'l1', lead_name: 'Priya Shah', message: 'Hi there', status: 'sent' },
      { type: 'email_reply', at: '2026-08-13T11:00:00Z', lead_id: 'l1', lead_name: 'Priya Shah', subject: 'Re: Welcome' },
      { type: 'email_sent', at: '2026-08-13T10:00:00Z', lead_id: 'l1', lead_name: 'Priya Shah', subject: 'Welcome', opened: true, clicked: false },
    ]);
    const user = userEvent.setup();
    render(<ActivityPanel journeyId="j1" />);

    await user.click(screen.getByText('Activity'));
    await waitFor(() => expect(getActivity).toHaveBeenCalledWith('j1'));

    expect(await screen.findByText('SMS sent to Priya Shah')).toBeInTheDocument();
    expect(screen.getByText('Priya Shah replied')).toBeInTheDocument();
    expect(screen.getByText('Email sent to Priya Shah')).toBeInTheDocument();
  });

  it('renders a whatsapp send and reply, distinct from sms', async () => {
    getActivity.mockResolvedValue([
      { type: 'whatsapp_sent', at: '2026-08-13T12:00:00Z', lead_id: 'l1', lead_name: 'Priya Shah', message: 'Hi!', status: 'sent' },
      { type: 'whatsapp_reply', at: '2026-08-13T11:00:00Z', lead_id: 'l1', lead_name: 'Priya Shah', message: 'Sounds good' },
      { type: 'whatsapp_sent', at: '2026-08-13T10:00:00Z', lead_id: 'l1', lead_name: 'Priya Shah', message: 'failed one', status: 'failed' },
    ]);
    const user = userEvent.setup();
    render(<ActivityPanel journeyId="j1" />);

    await user.click(screen.getByText('Activity'));
    await waitFor(() => expect(screen.getAllByText('WhatsApp sent to Priya Shah').length).toBe(2));
    expect(screen.getByText('Priya Shah replied via WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('labels an auto-reply distinctly from a real reply', async () => {
    getActivity.mockResolvedValue([
      { type: 'email_auto_reply', at: '2026-08-13T11:00:00Z', lead_id: 'l1', lead_name: 'Priya Shah', subject: 'Automatic reply' },
    ]);
    const user = userEvent.setup();
    render(<ActivityPanel journeyId="j1" />);

    await user.click(screen.getByText('Activity'));
    expect(await screen.findByText('Priya Shah — auto-reply (out-of-office)')).toBeInTheDocument();
  });
});
