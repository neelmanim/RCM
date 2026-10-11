import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from '../../pages/Dashboard';

const day = (over = {}) => ({
  date: '2026-10-08',
  window: { start: '2026-10-07T18:30:00+00:00', end: '2026-10-08T18:30:00+00:00' },
  given: {
    total: 3, assigned: 1, reset: 2, page: 1, pages: 1, per_page: 10,
    leads: [
      { id: 'l1', name: 'Asha Rao', company: 'Acme Hospital', status: 'Lead Assigned', reason: 'Assigned to you', at: '2026-10-08T04:00:00Z' },
      { id: 'l2', name: 'Bo Chen', company: 'Beta Clinic', status: 'Lead Assigned', reason: 'Reset to Lead Assigned', at: '2026-10-08T03:00:00Z' },
      { id: 'l3', name: 'Cy Dun', company: null, status: 'Lead Assigned', reason: 'Reset to Lead Assigned', at: '2026-10-08T02:00:00Z' },
    ],
  },
  did: {
    calls: 4, notes: 1, status_changes: 2, meetings_booked: 1, emails: 0, leads_worked: 5,
    by_kind: { call: 4, note: 1, status: 2, email: 0 }, activity_total: 7, page: 1, pages: 1, per_page: 10,
    activity: [{ kind: 'call', at: '2026-10-08T05:00:00Z', lead_id: 'l1', lead: 'Asha Rao', company: 'Acme Hospital', text: 'Call — No Answer' }],
  },
  now: { not_yet_called: 140 },
  ...over,
});

vi.mock('../../services/api', () => ({
  LeadsService: {
    getDashboardStats: vi.fn(() => Promise.resolve({ total: 294, status_counts: { 'Lead Assigned': 140, Calling: 104, 'Meeting Scheduled': 8 }, parked_count: 2 })),
    getErrorLogSummary: vi.fn(() => Promise.resolve({ total: 0 })),
    getGrowthIntelligence: vi.fn(() => Promise.resolve(null)),
  },
  AnalyticsService: { getTrend: vi.fn(() => Promise.resolve(null)), getSdrTable: vi.fn(() => Promise.resolve({ sdrs: [] })) },
  LeaderboardService: { getTop: vi.fn(() => Promise.resolve([])) },
  InstantlyInboxService: { summary: vi.fn(() => Promise.resolve({})) },
  MyDayService: { get: vi.fn(), exportCsv: vi.fn(() => Promise.resolve()), exportActivity: vi.fn(() => Promise.resolve()),
    lifecycle: vi.fn(() => Promise.resolve({ counts: { 'New to me': 5, Inherited: 3, 'In progress': 7 } })) },
}));

const lastViewState = () => JSON.parse(sessionStorage.getItem('leadsHub.viewState'));

describe('Dashboard — rep view', () => {
  beforeEach(async () => {
    window.__CRM_CAPS__ = { export: true };          // this user may export (the shell publishes it from /api/me/capabilities)
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.setItem('alternate:dashboard-tour-seen', '1');
    const { MyDayService } = await import('../../services/api');
    MyDayService.get.mockResolvedValue(day());
  });

  it('says what each card counts and uses the real given-today / not-yet-called numbers', async () => {
    render(<Dashboard userRole="SDR" userName="Asha Rao" />);
    expect(await screen.findByText('Assigned to me')).toBeInTheDocument();
    expect(await screen.findByText('140')).toBeInTheDocument();                       // Not yet called (from /my-day)
    expect(screen.getByText('1 assigned · 2 reset')).toBeInTheDocument();
    expect(await screen.findByText('5 new · 3 inherited · 7 in progress')).toBeInTheDocument();   // Assigned to me, split by state
    expect(screen.queryByText('Untouched leads')).not.toBeInTheDocument();
    expect(screen.queryByText(/Call outcomes today/i)).not.toBeInTheDocument();      // the Power Dialer's Today panel owns that
  });

  it('every number opens what it counts: smart views for Given today / Not yet called, status filters for the rest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });             // the tile's day bounds come from the browser's today; pin it
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
    const onNavigate = vi.fn();
    render(<Dashboard userRole="SDR" userName="Asha Rao" onNavigate={onNavigate} />);
    await screen.findByText('140');

    await userEvent.click(screen.getByText('Given today'));
    expect(onNavigate).toHaveBeenLastCalledWith('leads');
    expect(lastViewState().smartView).toMatchObject({ key: 'given_today', from: '2026-10-07T18:30:00+00:00', to: '2026-10-08T18:30:00+00:00' });

    await userEvent.click(screen.getByText('Not yet called'));
    expect(lastViewState().smartView).toMatchObject({ key: 'not_yet_called' });
    expect(lastViewState().filters).toEqual({});

    await userEvent.click(screen.getByText('Calling stage'));
    expect(lastViewState()).toMatchObject({ filters: { status: ['Calling'] }, activeFilterKeys: ['status'], smartView: null });

    await userEvent.click(screen.getByText('Meetings+'));
    expect(lastViewState().filters.status).toEqual(['Meeting Scheduled', 'Demo Scheduled', 'Demo Done', 'Completed']);

    await userEvent.click(screen.getByText('Calls today'));
    expect(onNavigate).toHaveBeenLastCalledWith('my-calls');
  });

  it('My Day pages the lists, opens a lead, filters activity by kind and exports the whole day', async () => {
    const onLeadClick = vi.fn();
    const { MyDayService } = await import('../../services/api');
    render(<Dashboard userRole="SDR" userName="Asha Rao" onLeadClick={onLeadClick} />);
    const card = await screen.findByTestId('my-day');
    await within(card).findByText('Asha Rao');
    expect(within(card).getByText('Showing 1–3 of 3')).toBeInTheDocument();
    await userEvent.click(within(card).getByText('Asha Rao'));
    expect(onLeadClick).toHaveBeenCalledWith('l1');

    await userEvent.click(within(card).getByRole('button', { name: /What I did/ }));
    expect(await within(card).findByText('Call — No Answer')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: /^Calls/ }));
    await waitFor(() => expect(MyDayService.get).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'call', did_page: 1 })));

    await userEvent.click(within(card).getByRole('button', { name: /Export CSV/ }));
    expect(MyDayService.exportCsv).toHaveBeenCalledWith(undefined);                  // today = no date param
  });

  it('Yesterday and the date picker request that date; a failure offers a retry instead of showing zeros', async () => {
    const { MyDayService } = await import('../../services/api');
    render(<Dashboard userRole="SDR" userName="Asha Rao" />);
    const card = await screen.findByTestId('my-day');
    await within(card).findByText('Asha Rao');
    MyDayService.get.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(within(card).getByRole('button', { name: 'Yesterday' }));
    expect(await within(card).findByText(/Couldn't load this just now/)).toBeInTheDocument();
    expect(MyDayService.get).toHaveBeenLastCalledWith(expect.objectContaining({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    await userEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(await within(card).findByText('Asha Rao')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Pick a date/ })).toBeInTheDocument();   // any past day, not just yesterday
  });
});

describe('Dashboard — admin view', () => {
  beforeEach(async () => {
    window.__CRM_CAPS__ = { export: true };          // this user may export (the shell publishes it from /api/me/capabilities)
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.setItem('alternate:dashboard-tour-seen', '1');
  });

  it('keeps its own view (no My Day, no extra request) and its numbers open filtered leads too', async () => {
    const { MyDayService } = await import('../../services/api');
    const onNavigate = vi.fn();
    render(<Dashboard userRole="Super Admin" userName="Neel" onNavigate={onNavigate} />);
    await screen.findByText('Total leads');
    expect(screen.queryByTestId('my-day')).not.toBeInTheDocument();
    expect(MyDayService.get).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('No phone'));
    expect(lastViewState().filters.status).toEqual(['No Phone - Parked']);
    expect(onNavigate).toHaveBeenLastCalledWith('leads');
  });
});
