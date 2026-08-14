import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PowerDialerHub } from '../../features/power-dialer-hub/PowerDialerHub';
import { LeadsService, CallsService, DialerService } from '../../services/api';

vi.mock('../../services/api', () => ({
  LeadsService: { getLeads: vi.fn() },
  CallsService: { getTodayCalls: vi.fn() },
  DialerService: { getStatus: vi.fn(), getQueueStatus: vi.fn(), setQueueStatus: vi.fn(), clearQueueStatus: vi.fn(), getSkipSummary: vi.fn() },
}));

const emptyStats = { date: '2026-08-07', summary: { total: 0, connected: 0, no_answer: 0, voicemail: 0, callback: 0, meeting: 0, other: 0 }, calls: [] };

describe('PowerDialerHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CallsService.getTodayCalls.mockResolvedValue(emptyStats);
    DialerService.getStatus.mockResolvedValue({ active: false, provider: 'none' });
  });

  it('shows an empty state when there are no callable leads', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [] });
    render(<PowerDialerHub />);
    await waitFor(() => expect(screen.getByText('No leads to call right now.')).toBeInTheDocument());
  });

  it('shows the current lead and the queue list once leads load', async () => {
    LeadsService.getLeads.mockResolvedValue({
      data: [
        { id: '1', first_name: 'Jane', last_name: 'Doe', company: 'Acme', phone: '+91900000001', status: 'Lead Assigned' },
        { id: '2', first_name: 'John', last_name: 'Roe', company: 'Beta', phone: '+91900000002', status: 'Research' },
      ],
    });
    render(<PowerDialerHub />);

    // Current lead appears in both the card and the queue list.
    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('John Roe')).toBeInTheDocument();
    // Nothing resolved yet — 0 of 2 worked through.
    expect(screen.getByText(/0 of 2 worked through/)).toBeInTheDocument();
  });

  it('renders today\'s stats panel alongside the queue', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [] });
    render(<PowerDialerHub />);
    await waitFor(() => expect(screen.getByText("Today's Calls")).toBeInTheDocument());
  });

  it('debounces the search box before re-fetching', async () => {
    vi.useFakeTimers();
    LeadsService.getLeads.mockResolvedValue({ data: [] });
    render(<PowerDialerHub />);
    await vi.waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText(/Search name, company, phone/), { target: { value: 'acme' } });
    expect(LeadsService.getLeads).toHaveBeenCalledTimes(1); // not yet — still debouncing

    await vi.advanceTimersByTimeAsync(450);
    await vi.waitFor(() => expect(LeadsService.getLeads).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'acme' })
    ));
    vi.useRealTimers();
  });

  it('keeps showing the current lead during a background re-fetch instead of hiding it', async () => {
    vi.useFakeTimers();
    const initialLead = { id: '1', first_name: 'Jane', last_name: 'Doe', company: 'Acme', phone: '+91900000001', status: 'Lead Assigned' };
    LeadsService.getLeads.mockResolvedValueOnce({ data: [initialLead] });
    render(<PowerDialerHub />);
    await vi.waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0));

    // The re-fetch triggered by typing in search never resolves within this
    // test — if the card depended on `!loading`, it would vanish right now.
    let resolveSecondFetch;
    LeadsService.getLeads.mockReturnValueOnce(new Promise(res => { resolveSecondFetch = res; }));
    fireEvent.change(screen.getByPlaceholderText(/Search name, company, phone/), { target: { value: 'acme' } });
    await vi.advanceTimersByTimeAsync(450);
    await vi.waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalledTimes(2));

    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0); // still visible, mid-refetch

    resolveSecondFetch({ data: [initialLead] });
    vi.useRealTimers();
  });

  it('never lets every status checkbox be unchecked', async () => {
    const user = userEvent.setup();
    LeadsService.getLeads.mockResolvedValue({ data: [] });
    render(<PowerDialerHub />);
    await waitFor(() => expect(LeadsService.getLeads).toHaveBeenCalled());

    const checkboxes = [screen.getByLabelText('New'), screen.getByLabelText('Research'), screen.getByLabelText('Calling')];
    for (const cb of checkboxes) await user.click(cb); // uncheck all three, one by one

    const stillChecked = checkboxes.filter(cb => cb.checked);
    expect(stillChecked).toHaveLength(1); // the last one refuses to uncheck
  });

  it('only mounts the Skip Reasons panel for admin roles', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [] });
    DialerService.getSkipSummary.mockResolvedValue({ total_skips: 0, dnc_skips: 0, by_reason: [], by_rep: [] });

    const { rerender } = render(<PowerDialerHub userRole="SDR" />);
    await waitFor(() => expect(screen.getByText("Today's Calls")).toBeInTheDocument());
    expect(screen.queryByText('Skip Reasons')).not.toBeInTheDocument();

    rerender(<PowerDialerHub userRole="Super Admin" />);
    await waitFor(() => expect(screen.getByText('Skip Reasons')).toBeInTheDocument());
  });

  it('shows today\'s real call total in the header, not a session-local count', async () => {
    LeadsService.getLeads.mockResolvedValue({ data: [] });
    CallsService.getTodayCalls.mockResolvedValue({ ...emptyStats, summary: { ...emptyStats.summary, total: 8 } });
    render(<PowerDialerHub />);
    // "calls today" only exists in the headline widget (unlike bare "8",
    // which also matches the unrelated "Total" tile in TodayStatsPanel).
    await waitFor(() => expect(screen.getByText('calls today')).toBeInTheDocument());
    expect(screen.getByText('calls today').previousSibling).toHaveTextContent('8');
  });

  it('passes onLeadClick through to the current-call card ("View in CRM")', async () => {
    const user = userEvent.setup();
    const onLeadClick = vi.fn();
    LeadsService.getLeads.mockResolvedValue({
      data: [{ id: '1', first_name: 'Jane', last_name: 'Doe', company: 'Acme', phone: '+91900000001', status: 'Lead Assigned' }],
    });
    render(<PowerDialerHub onLeadClick={onLeadClick} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /View in CRM/ })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /View in CRM/ }));
    expect(onLeadClick).toHaveBeenCalledWith('1');
  });
});
