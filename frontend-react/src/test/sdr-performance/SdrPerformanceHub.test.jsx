import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SdrPerformanceHub } from '../../features/sdr-performance/SdrPerformanceHub';
import { CallsService } from '../../services/api';

/**
 * Port of frontend/js/views/sdr_performance.js (v12.2.4). Same
 * fetchSdrPerformance(sdrId, {period, start_date, end_date}) contract; the
 * legacy page stays wired as app.js's bundle-load-failure fallback only.
 */
vi.mock('../../services/api', () => ({
  CallsService: { getSdrPerformance: vi.fn() },
}));

const RESPONSE = {
  sdr: { id: 'u1', name: 'Asha Rao', email: 'asha@test.com', pod_name: 'Alpha' },
  productivity: { total_leads_assigned: 40, assigned_now: 1197, active_leads: 12, leads_closed: 8, calls_made: 96, avg_calls_per_lead: 2.4 },
  conversion: { meetings_scheduled: 9, conversion_rate: 22 },
  efficiency: { avg_time_per_lead_hours: 30, median_time_per_lead_hours: 18 },
  funnel: { 'Lead Assigned': 40, 'Calling': 25, 'Meeting Scheduled': 9, 'Completed': 8 },
  funnel_now: { 'Lead Assigned': 113, 'Calling': 746, 'Meeting Scheduled': 29, 'Completed': 3 },
};

describe('SdrPerformanceHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CallsService.getSdrPerformance.mockResolvedValue(RESPONSE);
  });

  it('loads all_time by default and renders the metric cards', async () => {
    render(<SdrPerformanceHub sdrId="u1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());

    expect(CallsService.getSdrPerformance).toHaveBeenCalledWith('u1', {
      period: 'all_time', start_date: undefined, end_date: undefined,
    });
    expect(screen.getByText('POD: Alpha · asha@test.com · Performance Analytics')).toBeInTheDocument();
    // 40 and 8 also appear as funnel counts (Lead Assigned/Completed) — pick
    // values unique to the metric-card row.
    expect(screen.getByText('1197')).toBeInTheDocument();  // Assigned Now (all) — the whole pipeline, not just what moved
    expect(screen.getByText('12')).toBeInTheDocument();  // Moved stage
    expect(screen.getByText('96')).toBeInTheDocument();  // Calls Made
    expect(screen.getByText('22%')).toBeInTheDocument(); // Conv. Rate
  });

  it('shows every funnel stage from the response', async () => {
    render(<SdrPerformanceHub sdrId="u1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Current Pipeline')).toBeInTheDocument());
    expect(screen.getByText(/Stage Movement/)).toBeInTheDocument();
    // both funnels list each stage (current pipeline + movement in the period)
    for (const stage of Object.keys(RESPONSE.funnel)) {
      expect(screen.getAllByText(stage).length).toBe(2);
    }
  });

  it('formats hours over a day as whole days', async () => {
    // 30h -> 1d (rounds), 18h stays in hours — both units the legacy page
    // used. "Avg Time/Lead" repeats the same 1d in its own metric card, so
    // scope the assertion to the Efficiency Metrics detail card.
    render(<SdrPerformanceHub sdrId="u1" onBack={() => {}} />);
    const heading = await screen.findByText('Efficiency Metrics');
    const detail = within(heading.closest('div').parentElement);
    expect(detail.getByText('1d')).toBeInTheDocument();
    expect(detail.getByText('18h')).toBeInTheDocument();
  });

  it('re-fetches with the new period when a preset is clicked', async () => {
    render(<SdrPerformanceHub sdrId="u1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'This Week' }));
    await waitFor(() => expect(CallsService.getSdrPerformance).toHaveBeenLastCalledWith('u1', {
      period: 'this_week', start_date: undefined, end_date: undefined,
    }));
  });

  it('only fetches a custom range once both dates are set', async () => {
    render(<SdrPerformanceHub sdrId="u1" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    const callsBefore = CallsService.getSdrPerformance.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: /Custom/ }));
    // Opening the custom picker alone must not fire another request — only a
    // completed range (both dates present) should, mirroring the legacy
    // page's "Apply" button gate.
    expect(CallsService.getSdrPerformance).toHaveBeenCalledTimes(callsBefore);
  });

  it('calls onBack when Back is clicked', async () => {
    const onBack = vi.fn();
    render(<SdrPerformanceHub sdrId="u1" onBack={onBack} />);
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows a retry-to-Leaderboard error state instead of a blank page on failure', async () => {
    CallsService.getSdrPerformance.mockRejectedValue({ response: { data: { detail: 'You can only view your own performance.' } } });
    const onBack = vi.fn();
    render(<SdrPerformanceHub sdrId="someone-else" onBack={onBack} />);

    await waitFor(() => expect(screen.getByText('You can only view your own performance.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Back to Leaderboard/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('re-fetches when sdrId changes (Leaderboard opening a different person)', async () => {
    const { rerender } = render(<SdrPerformanceHub sdrId="u1" onBack={() => {}} />);
    await waitFor(() => expect(CallsService.getSdrPerformance).toHaveBeenCalledWith('u1', expect.anything()));

    CallsService.getSdrPerformance.mockResolvedValue({ ...RESPONSE, sdr: { ...RESPONSE.sdr, name: 'Bilal Khan' } });
    rerender(<SdrPerformanceHub sdrId="u2" onBack={() => {}} />);
    await waitFor(() => expect(CallsService.getSdrPerformance).toHaveBeenCalledWith('u2', expect.anything()));
    await waitFor(() => expect(screen.getByText('Bilal Khan')).toBeInTheDocument());
  });
});
