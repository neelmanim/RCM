import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportingTab } from '../../features/sales-journey/ReportingTab';

const getStats = vi.fn();
const getStatsByRep = vi.fn();
const getStatsTrend = vi.fn();
const getEnrollmentRoster = vi.fn();
const getActivity = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    getStats: (...args) => getStats(...args),
    getStatsByRep: (...args) => getStatsByRep(...args),
    getStatsTrend: (...args) => getStatsTrend(...args),
    getEnrollmentRoster: (...args) => getEnrollmentRoster(...args),
    getActivity: (...args) => getActivity(...args),
  },
}));

beforeEach(() => {
  getStats.mockReset().mockResolvedValue({ engagement: { overall: { sent: 0, opened: 0, clicked: 0, replied: 0, open_rate: 0, click_rate: 0, reply_rate: 0 }, by_step: {} }, total: 0 });
  getStatsByRep.mockReset().mockResolvedValue({ reps: [] });
  getStatsTrend.mockReset().mockResolvedValue({ bucket: 'week', points: [] });
  getEnrollmentRoster.mockReset();
  getActivity.mockReset();
});

describe('ReportingTab', () => {
  it('fetches activity once and makes it available to the roster\'s per-lead expand row', async () => {
    getActivity.mockResolvedValue([
      { type: 'email_sent', at: '2026-09-01T10:00:00Z', lead_id: 'lead-1', lead_name: 'Priya Shah', subject: 'Welcome', opened: false, clicked: false },
    ]);
    getEnrollmentRoster.mockResolvedValue({
      total: 1, offset: 0, limit: 500, status_counts: { active: 1 }, stage_breakdown: [],
      enrollments: [{ enrollment_id: 'e1', lead_id: 'lead-1', lead_name: 'Priya Shah', lead_company: null, status: 'active', current_node_label: 'Email', exited_reason: null }],
    });
    const user = userEvent.setup();
    render(<ReportingTab journeyId="j1" nodes={[]} />);

    await waitFor(() => expect(getActivity).toHaveBeenCalledWith('j1'));
    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();

    await user.click(screen.getByText('Priya Shah'));
    expect(await screen.findByText('Email sent to Priya Shah')).toBeInTheDocument();
  });
});
