import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnrollmentRosterPanel } from '../../features/sales-journey/EnrollmentRosterPanel';

const getEnrollmentRoster = vi.fn();
const exportEnrollmentsCsv = vi.fn();

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    getEnrollmentRoster: (...args) => getEnrollmentRoster(...args),
    exportEnrollmentsCsv: (...args) => exportEnrollmentsCsv(...args),
  },
}));

beforeEach(() => {
  window.__CRM_CAPS__ = { export: true };          // this user may export (the shell publishes it from /api/me/capabilities)
  getEnrollmentRoster.mockReset();
  exportEnrollmentsCsv.mockReset();
});

describe('EnrollmentRosterPanel', () => {
  it('is open by default and fetches immediately — a demo presenter should never need to find a toggle', async () => {
    getEnrollmentRoster.mockResolvedValue({ total: 0, offset: 0, limit: 500, enrollments: [], status_counts: {}, stage_breakdown: [] });
    render(<EnrollmentRosterPanel journeyId="j1" />);
    await waitFor(() => expect(getEnrollmentRoster).toHaveBeenCalledWith('j1', 0));
    expect(await screen.findByText('No leads have been enrolled yet.')).toBeInTheDocument();
  });

  it('loads and renders the roster, including status and stage breakdown badges', async () => {
    getEnrollmentRoster.mockResolvedValue({
      total: 2, offset: 0, limit: 500,
      status_counts: { active: 1, exited_early: 1 },
      stage_breakdown: [{ node_id: 'n2', label: 'Email #2', count: 1 }],
      enrollments: [
        { enrollment_id: 'e1', lead_name: 'Paul Lead', lead_company: 'Acme', status: 'active', current_node_label: 'Email #2', exited_reason: null },
        { enrollment_id: 'e2', lead_name: 'Dana Lead', lead_company: null, status: 'exited_early', current_node_label: null, exited_reason: 'replied' },
      ],
    });
    render(<EnrollmentRosterPanel journeyId="j1" />);

    expect(await screen.findByText('Paul Lead · Acme')).toBeInTheDocument();
    expect(screen.getByText('Email #2')).toBeInTheDocument();
    expect(screen.getByText('The lead replied — cadence stopped')).toBeInTheDocument();
    // The "at what stage are they" at-a-glance badges, visible without scrolling the per-lead list.
    expect(screen.getByText(/1 In progress/)).toBeInTheDocument();
    expect(screen.getByText(/1 Exited/)).toBeInTheDocument();
    expect(screen.getByText('1 at Email #2')).toBeInTheDocument();
  });

  it('shows how a lead was enrolled when its row is expanded', async () => {
    getEnrollmentRoster.mockResolvedValue({
      total: 1, offset: 0, limit: 500, status_counts: { active: 1 }, stage_breakdown: [],
      enrollments: [{ enrollment_id: 'e1', lead_id: 'l1', lead_name: 'Paul Lead', lead_company: null, status: 'active',
        current_node_label: 'Email #2', exited_reason: null, enrolled_via: 'trigger:status_changed' }],
    });
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" />);
    await user.click(await screen.findByText('Paul Lead'));
    expect(screen.getByText(/Enrolled: automatically, when the lead's status changed/)).toBeInTheDocument();
  });

  it('downloads the CSV export when clicked', async () => {
    getEnrollmentRoster.mockResolvedValue({ total: 0, offset: 0, limit: 500, enrollments: [], status_counts: {}, stage_breakdown: [] });
    exportEnrollmentsCsv.mockResolvedValue();
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" />);
    await screen.findByText('No leads have been enrolled yet.');

    await user.click(screen.getByText('Download CSV'));
    await waitFor(() => expect(exportEnrollmentsCsv).toHaveBeenCalledWith('j1'));
  });

  it('shows a Load more button when more rows remain', async () => {
    getEnrollmentRoster.mockResolvedValue({
      total: 5, offset: 0, limit: 500,
      status_counts: { completed: 5 }, stage_breakdown: [],
      enrollments: [{ enrollment_id: 'e1', lead_name: 'Paul Lead', lead_company: null, status: 'completed', current_node_label: null, exited_reason: null }],
    });
    render(<EnrollmentRosterPanel journeyId="j1" />);
    expect(await screen.findByText('Load more (4 remaining)')).toBeInTheDocument();
  });

  it('can still be collapsed via the header toggle', async () => {
    getEnrollmentRoster.mockResolvedValue({ total: 0, offset: 0, limit: 500, enrollments: [], status_counts: {}, stage_breakdown: [] });
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" />);
    await screen.findByText('No leads have been enrolled yet.');

    await user.click(screen.getByText(/Enrolled leads/));
    expect(screen.queryByText('No leads have been enrolled yet.')).not.toBeInTheDocument();
  });

  it('expands a row to show that lead\'s activity events, passed in via the activity prop', async () => {
    getEnrollmentRoster.mockResolvedValue({
      total: 1, offset: 0, limit: 500, status_counts: { active: 1 }, stage_breakdown: [],
      enrollments: [{ enrollment_id: 'e1', lead_id: 'lead-1', lead_name: 'Paul Lead', lead_company: null, status: 'active', current_node_label: 'Email', exited_reason: null }],
    });
    const activity = [
      { type: 'email_sent', at: '2026-09-01T10:00:00Z', lead_id: 'lead-1', lead_name: 'Paul Lead', subject: 'Hi', opened: true, clicked: false },
      { type: 'email_sent', at: '2026-09-01T10:00:00Z', lead_id: 'lead-2', lead_name: 'Other Lead', subject: 'Not this one', opened: false, clicked: false },
    ];
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" activity={activity} />);

    const row = await screen.findByText('Paul Lead');
    expect(screen.queryByText('Email sent to Paul Lead')).not.toBeInTheDocument();

    await user.click(row);
    expect(await screen.findByText('Email sent to Paul Lead')).toBeInTheDocument();
    expect(screen.queryByText('Email sent to Other Lead')).not.toBeInTheDocument();

    await user.click(row);
    expect(screen.queryByText('Email sent to Paul Lead')).not.toBeInTheDocument();
  });

  it('a lead with no tracked events says so instead of showing nothing', async () => {
    getEnrollmentRoster.mockResolvedValue({
      total: 1, offset: 0, limit: 500, status_counts: { active: 1 }, stage_breakdown: [],
      enrollments: [{ enrollment_id: 'e1', lead_id: 'lead-1', lead_name: 'Paul Lead', lead_company: null, status: 'active', current_node_label: 'Email', exited_reason: null }],
    });
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" activity={[]} />);

    await user.click(await screen.findByText('Paul Lead'));
    expect(await screen.findByText('No tracked activity for this lead yet.')).toBeInTheDocument();
  });

  it('search narrows the roster by lead or company name', async () => {
    getEnrollmentRoster.mockResolvedValue({
      total: 2, offset: 0, limit: 500, status_counts: { active: 2 }, stage_breakdown: [],
      enrollments: [
        { enrollment_id: 'e1', lead_id: 'l1', lead_name: 'Paul Lead', lead_company: 'Acme', status: 'active', current_node_label: 'Email', exited_reason: null },
        { enrollment_id: 'e2', lead_id: 'l2', lead_name: 'Dana Lead', lead_company: 'Globex', status: 'active', current_node_label: 'Email', exited_reason: null },
      ],
    });
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" />);
    await screen.findByText('Paul Lead · Acme');

    await user.type(screen.getByPlaceholderText('Search by lead or company…'), 'dana');
    expect(screen.queryByText('Paul Lead · Acme')).not.toBeInTheDocument();
    expect(screen.getByText('Dana Lead · Globex')).toBeInTheDocument();
  });

  it('clicking a status badge filters the table to that status, and clicking it again clears the filter', async () => {
    getEnrollmentRoster.mockResolvedValue({
      total: 2, offset: 0, limit: 500, status_counts: { active: 1, completed: 1 }, stage_breakdown: [],
      enrollments: [
        { enrollment_id: 'e1', lead_id: 'l1', lead_name: 'Paul Lead', lead_company: null, status: 'active', current_node_label: 'Email', exited_reason: null },
        { enrollment_id: 'e2', lead_id: 'l2', lead_name: 'Dana Lead', lead_company: null, status: 'completed', current_node_label: null, exited_reason: null },
      ],
    });
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" />);
    await screen.findByText('Paul Lead');

    await user.click(screen.getByText(/1 Completed/));
    expect(screen.queryByText('Paul Lead')).not.toBeInTheDocument();
    expect(screen.getByText('Dana Lead')).toBeInTheDocument();

    await user.click(screen.getByText('clear filter'));
    expect(screen.getByText('Paul Lead')).toBeInTheDocument();
    expect(screen.getByText('Dana Lead')).toBeInTheDocument();
  });

  it('clicking a column header sorts the table by that column', async () => {
    getEnrollmentRoster.mockResolvedValue({
      total: 2, offset: 0, limit: 500, status_counts: { active: 2 }, stage_breakdown: [],
      enrollments: [
        { enrollment_id: 'e1', lead_id: 'l1', lead_name: 'Zed Lead', lead_company: null, status: 'active', current_node_label: 'Email', exited_reason: null },
        { enrollment_id: 'e2', lead_id: 'l2', lead_name: 'Amy Lead', lead_company: null, status: 'active', current_node_label: 'Email', exited_reason: null },
      ],
    });
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" />);
    await screen.findByText('Zed Lead');

    const leadNamesInOrder = () => screen.getAllByRole('row').slice(1).map((r) => r.textContent).filter(Boolean);
    // Default sort is already ascending by lead name.
    expect(leadNamesInOrder()[0]).toContain('Amy Lead');

    await user.click(screen.getByText(/^Lead/));
    expect(leadNamesInOrder()[0]).toContain('Zed Lead');
  });

  it('paginates the table into pages once there are more than one page\'s worth of rows', async () => {
    const enrollments = Array.from({ length: 25 }, (_, i) => ({
      enrollment_id: `e${i}`, lead_id: `l${i}`, lead_name: `Lead ${String(i).padStart(2, '0')}`,
      lead_company: null, status: 'active', current_node_label: 'Email', exited_reason: null,
    }));
    getEnrollmentRoster.mockResolvedValue({
      total: 25, offset: 0, limit: 500, status_counts: { active: 25 }, stage_breakdown: [], enrollments,
    });
    const user = userEvent.setup();
    render(<EnrollmentRosterPanel journeyId="j1" />);
    await screen.findByText('Lead 00');

    expect(screen.queryByText('Lead 20')).not.toBeInTheDocument(); // page 1 only shows the first 20
    expect(screen.getByText('1 / 2')).toBeInTheDocument();

    await user.click(screen.getByText('Next'));
    expect(await screen.findByText('Lead 20')).toBeInTheDocument();
    expect(screen.queryByText('Lead 00')).not.toBeInTheDocument();
  });
});
