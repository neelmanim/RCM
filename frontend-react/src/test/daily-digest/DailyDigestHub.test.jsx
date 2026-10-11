import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyDigestHub } from '../../features/daily-digest/DailyDigestHub';
import { DailyDigestService, FunnelService, PodsService, SavedViewsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  DailyDigestService: { get: vi.fn(), leads: vi.fn(), exportXlsx: vi.fn() },
  PodsService: { getAll: vi.fn() },
  FunnelService: { get: vi.fn(), exportXlsx: vi.fn() },
  DigestDrillService: { breakdown: vi.fn(() => Promise.resolve({ error: 'off in this test' })), accounts: vi.fn(), calls: vi.fn(), getIcp: vi.fn(), setIcp: vi.fn() },
  SavedViewsService: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));

const k = (today, compare = 0, delta_pct = null) => ({ today, compare, delta_pct });
const CATALOG = [
  ['Activity', 'calls_made', 'Calls', 'calls'], ['Activity', 'emails_sent', 'Emails sent', 'emails'], ['Activity', 'research_notes', 'Research notes', 'notes'],
  ['Activity', 'leads_touched', 'Leads touched', null], ['Activity', 'conversations', 'Conversations', null],
  ['Meetings', 'meetings_booked', 'Meetings booked', 'meetings'], ['Meetings', 'meetings_held', 'Meetings held', null],
  ['Pipeline', 'new_leads', 'New leads', null], ['Pipeline', 'pipeline_moved', 'Pipeline moved', null], ['Pipeline', 'demos_completed', 'Demos completed', null],
  ['Pipeline', 'leads_researched', 'Leads researched', null], ['Outreach', 'campaigns_sent', 'Campaign emails sent', null], ['Outreach', 'cadence_enrollments', 'Cadence enrollments', null],
].map(([group, key, label, activity]) => ({ group, key, label, hint: `${label} hint`, activity }));
const DIGEST = {
  digest_date: '2026-09-07', comparison_date: '2026-08-31', original_date: '2026-09-07', is_working_day: true, timezone: 'Asia/Kolkata',
  mode: 'day', from: '2026-09-07', to: '2026-09-07', days: 1, compare_from: '2026-08-31', compare_to: '2026-08-31', compare_label: 'same weekday last week',
  catalog: CATALOG, default_kpis: ['calls_made', 'emails_sent', 'research_notes', 'meetings_booked', 'leads_touched'],
  campaigns: [
    { campaign: 'US-Partner-FY27Q3', leads_touched: 12, calls: 20, emails: 5, notes: 2, meetings_booked: 1 },
    { campaign: 'No campaign', leads_touched: 18, calls: 20, emails: 7, notes: 3, meetings_booked: 1 },
  ],
  campaign_options: ['No campaign', 'US-Partner-FY27Q3'],
  kpi: {
    calls_made: k(40, 20, 100), emails_sent: k(12, 12, 0), research_notes: k(5, 0, 'new'), meetings_booked: k(2, 3, -33), leads_touched: k(30, 25, 20),
    new_leads: k(3, 1, 200), pipeline_moved: k(0), demos_completed: k(0), leads_researched: k(0), campaigns_sent: k(0), cadence_enrollments: k(0),
    conversations: k(9, 4, 125), meetings_held: k(1, 0, 'new'),
  },
  attention: [
    { key: 'idle_reps', count: 1, label: 'reps with no activity', rep_ids: ['u2'] },
    { key: 'overdue', count: 4, label: 'leads with an overdue follow-up' },
  ],
  lead_summary: { total: 30, overdue: 4, scheduled: 10, none_set: 16, meetings: 2 },
  sdr_snapshot: [
    { user_id: 'u1', name: 'Asha Rep', calls: 40, emails: 12, research_notes: 5, meetings: 2, leads_touched: 30, overdue_follow_ups: 4, calls_last_week: 20, emails_last_week: 12, research_notes_last_week: 0, meetings_last_week: 3, left: false, no_activity: false },
    { user_id: 'u2', name: 'Idle Rep', calls: 0, emails: 0, research_notes: 0, meetings: 0, leads_touched: 0, overdue_follow_ups: 0, calls_last_week: 3, emails_last_week: 0, research_notes_last_week: 0, meetings_last_week: 0, left: false, no_activity: true },
    { user_id: 'u3', name: 'Gone Rep', calls: 1, emails: 0, research_notes: 0, meetings: 0, leads_touched: 1, overdue_follow_ups: 0, calls_last_week: 0, emails_last_week: 0, research_notes_last_week: 0, meetings_last_week: 0, left: true, no_activity: false },
  ],
  pipeline_flow: [], status_snapshot: { Calling: 9 },
};
const LEADS = {
  items: [{ rep_id: 'u1', rep: 'Asha Rep', lead_id: 'l1', lead: 'Dana Lead', company: 'Acme', campaign: 'US-Partner-FY27Q3', status: 'Calling', calls: 2, emails: 1, notes: 1, meeting_booked: true, follow_up: 'Overdue', next_follow_up: '2026-09-01T10:00:00Z' }],
  total: 25, page: 1, pages: 3, per_page: 10,
};

const ROW = (key, label, booked) => ({ key, label, accounts: 5, contacts: 8, contacts_per_account: 1.6, conversations: 20, booked, sal: 1, held: 1, no_show: 0, won: 0, lost: 0,
  booked_per_100_conversations: 5, held_rate: 50, no_show_rate: 0 });
const FUNNEL = { from: '2026-08-10', to: '2026-09-08', group_by: 'none', rows: [ROW('all', 'All', 4)], total: ROW('total', 'Total', 4), campaigns: ['No campaign'], reps: [] };

describe('DailyDigestHub', () => {
  beforeEach(() => {
    window.__CRM_CAPS__ = { export: true };          // this user may export (the shell publishes it from /api/me/capabilities)
    window.localStorage.setItem('alternate:daily-digest-tour-seen-v2', '1');      // no guided tour over the page
    vi.clearAllMocks();
    DailyDigestService.get.mockResolvedValue(DIGEST);
    DailyDigestService.leads.mockResolvedValue(LEADS);
    PodsService.getAll.mockResolvedValue([]);
    FunnelService.get.mockResolvedValue(FUNNEL);
    SavedViewsService.list.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  // UTC "yesterday": the server rejects a date that isn't strictly in the past on its own clock (IST users hit a 400
  // between 00:00 and 05:30 when this was built from local time).
  it('requests UTC-yesterday even when the local date is a day ahead of UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-08T18:47:00Z'));
    render(<DailyDigestHub />);
    expect(DailyDigestService.get).toHaveBeenCalledWith({ date: '2026-09-07' }, '');
  });

  it('shows the five headline numbers with last-week context, and the rest behind "More numbers"', async () => {
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getAllByText('Calls').length).toBeGreaterThan(0));
    for (const t of ['Emails sent', 'Research notes', 'Meetings booked', 'Leads touched']) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.getByText('vs 20 same weekday last week')).toBeInTheDocument();
    expect(screen.getByText('More numbers and pipeline movement')).toBeInTheDocument();
  });

  it('clicking a headline number filters the lead list to the leads with that activity', async () => {
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText('Dana Lead')).toBeInTheDocument());
    await userEvent.click(screen.getByTitle('Show the leads with emails'));
    await waitFor(() => expect(DailyDigestService.leads).toHaveBeenLastCalledWith(expect.objectContaining({ activity: 'emails', page: 1 })));
    expect(screen.getByText('With emails')).toBeInTheDocument();
  });

  it('clicking a rep filters the lead list to that rep, and the chip clears it', async () => {
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText('Idle Rep')).toBeInTheDocument());
    await userEvent.click(screen.getAllByText('Asha Rep')[0]);                // the Team table comes first
    await waitFor(() => expect(DailyDigestService.leads).toHaveBeenLastCalledWith(expect.objectContaining({ rep_id: 'u1' })));
    await userEvent.click(screen.getByLabelText('Clear rep filter'));
    await waitFor(() => expect(DailyDigestService.leads).toHaveBeenLastCalledWith(expect.objectContaining({ rep_id: '' })));
  });

  it('flags the idle rep and the leaver, and "Needs attention" opens the overdue follow-ups', async () => {
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText('No activity')).toBeInTheDocument());
    expect(screen.getByText('Left')).toBeInTheDocument();
    await userEvent.click(screen.getByText('leads with an overdue follow-up'));
    await waitFor(() => expect(DailyDigestService.leads).toHaveBeenLastCalledWith(expect.objectContaining({ follow_up: 'Overdue' })));
  });

  it('pages the lead list on the server', async () => {
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText(/Showing 1–10 of 25/)).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: /Next/ }).at(-1));
    await waitFor(() => expect(DailyDigestService.leads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('opens the lead when its row is clicked', async () => {
    window._loadView = vi.fn();
    render(<DailyDigestHub />);
    await userEvent.click(await screen.findByText('Dana Lead'));
    expect(window._loadView).toHaveBeenCalledWith('lead-detail', 'l1');
    delete window._loadView;
  });

  it('exports the whole digest', async () => {
    DailyDigestService.exportXlsx.mockResolvedValue();
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText('Dana Lead')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Export Excel/ }));
    expect(DailyDigestService.exportXlsx).toHaveBeenCalled();
  });

  it('shows a pod picker only when there is more than one pod', async () => {
    PodsService.getAll.mockResolvedValue([{ id: 'p1', name: 'India' }, { id: 'p2', name: 'US' }]);
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByLabelText('Pod')).toBeInTheDocument());
  });

  it('surfaces a load failure instead of rendering an empty page silently', async () => {
    DailyDigestService.get.mockResolvedValue(null);
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText(/Failed to load the digest for this period/)).toBeInTheDocument());
  });

  it('shows only 8 reps in the Team table and pages through the rest', async () => {
    const reps = Array.from({ length: 11 }, (_, i) => ({ ...DIGEST.sdr_snapshot[0], user_id: `r${i}`, name: `Rep ${String(i).padStart(2, '0')}` }));
    DailyDigestService.get.mockResolvedValue({ ...DIGEST, sdr_snapshot: reps });
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText('Rep 00')).toBeInTheDocument());
    expect(screen.getByText('Rep 07')).toBeInTheDocument();
    expect(screen.queryByText('Rep 08')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reps per page')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Showing 1–8 of 11/).parentElement.querySelector('button:last-child'));
    await waitFor(() => expect(screen.getByText('Rep 08')).toBeInTheDocument());
    expect(screen.queryByText('Rep 00')).not.toBeInTheDocument();
  });

  it('shows the funnel for the digest\'s own period, regrouped by rep on request', async () => {
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText('Funnel')).toBeInTheDocument());
    await waitFor(() => expect(FunnelService.get).toHaveBeenCalledWith(expect.objectContaining({ group_by: 'none', from: '2026-09-07', to: '2026-09-07' })));
    await waitFor(() => expect(screen.getByText('Meetings booked', { selector: 'div' })).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Group funnel by'));
    await userEvent.click(await screen.findByText('By rep'));
    await waitFor(() => expect(FunnelService.get).toHaveBeenLastCalledWith(expect.objectContaining({ group_by: 'sdr' })));
  });

  it('says so when the funnel cannot load', async () => {
    FunnelService.get.mockResolvedValue({ error: 'Pick a range of at most 366 days.' });
    render(<DailyDigestHub />);
    await waitFor(() => expect(screen.getByText('Pick a range of at most 366 days.')).toBeInTheDocument());
  });

  // ── periods ───────────────────────────────────────────────────────────────────────────────────────────────────
  it('offers a period menu and asks for a range (not a day) when a longer period is chosen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T10:00:00Z'));                         // a Wednesday
    render(<DailyDigestHub />);
    await waitFor(() => expect(DailyDigestService.get).toHaveBeenCalledWith({ date: '2026-09-08' }, ''));
    await userEvent.click(screen.getByLabelText('Period'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Last 7 days' }));
    await waitFor(() => expect(DailyDigestService.get).toHaveBeenLastCalledWith({ from: '2026-09-02', to: '2026-09-08' }, ''));
    await userEvent.click(screen.getByLabelText('Period'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Last week (Mon–Sun)' }));
    await waitFor(() => expect(DailyDigestService.get).toHaveBeenLastCalledWith({ from: '2026-08-31', to: '2026-09-06' }, ''));
  });

  it('describes a multi-day period and what it is compared with, and the Funnel follows the same dates', async () => {
    DailyDigestService.get.mockResolvedValue({ ...DIGEST, mode: 'range', from: '2026-09-01', to: '2026-09-07', days: 7, compare_label: 'the previous 7 days' });
    render(<DailyDigestHub />);
    expect(await screen.findByText(/compared with the previous 7 days/)).toBeInTheDocument();
    expect(screen.getAllByText('vs 20 the previous 7 days').length).toBeGreaterThan(0);
    await waitFor(() => expect(FunnelService.get).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-09-01', to: '2026-09-07' })));
  });

  it('choosing Custom starts from the last 7 days, so the page is never blank, and shows the date picker', async () => {
    render(<DailyDigestHub />);
    await waitFor(() => expect(DailyDigestService.get).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByLabelText('Period'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Custom range…' }));
    expect(screen.getByLabelText('Digest dates')).toBeInTheDocument();
    await waitFor(() => expect(DailyDigestService.get).toHaveBeenCalledTimes(2));
    expect(DailyDigestService.get.mock.calls[1][0]).toEqual({ from: expect.any(String), to: expect.any(String) });
    expect(screen.queryByText('Pick the dates')).not.toBeInTheDocument();
  });

  it('shows the server\'s reason when a period is refused', async () => {
    DailyDigestService.get.mockResolvedValue({ error: 'Pick a range of at most 92 days.' });
    render(<DailyDigestHub />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a range of at most 92 days.');
  });

  // ── campaigns ─────────────────────────────────────────────────────────────────────────────────────────────────
  it('shows what was worked per campaign (untagged leads included) and a campaign on every lead', async () => {
    render(<DailyDigestHub />);
    const card = (await screen.findByText('Campaigns')).closest('.bg-white');
    expect(within(card).getByText('US-Partner-FY27Q3')).toBeInTheDocument();
    expect(within(card).getByText('No campaign')).toBeInTheDocument();
    expect(within(card).getByText('Untagged')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Dana Lead')).toBeInTheDocument());
    expect(screen.getAllByText('US-Partner-FY27Q3').length).toBeGreaterThan(1);          // the table row and the lead's Campaign column
  });

  it('clicking a campaign narrows the lead list to it, and the filter menu offers every campaign', async () => {
    render(<DailyDigestHub />);
    const card = (await screen.findByText('Campaigns')).closest('.bg-white');
    await userEvent.click(within(card).getByText('US-Partner-FY27Q3'));
    await waitFor(() => expect(DailyDigestService.leads).toHaveBeenLastCalledWith(expect.objectContaining({ campaign: 'US-Partner-FY27Q3' })));
    await userEvent.click(screen.getByLabelText('Campaign'));                              // a searchable picker: options are role=option
    expect(await screen.findByRole('option', { name: 'All campaigns' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No campaign' })).toBeInTheDocument();
  });

  // ── your own numbers, and saved views ─────────────────────────────────────────────────────────────────────────
  const customize = async () => {
    await userEvent.click(await screen.findByRole('button', { name: /Customize numbers/ }));
    return within(await screen.findByRole('dialog'));
  };

  it('Customize numbers: drop one, add another, reorder, Apply — the strip follows, other numbers move to "More"', async () => {
    render(<DailyDigestHub />);
    const dlg = await customize();
    expect(dlg.getByText('Shown (5/10)')).toBeInTheDocument();
    await userEvent.click(dlg.getByLabelText('Remove Emails sent'));
    await userEvent.click(dlg.getByRole('checkbox', { name: 'Conversations' }));
    await userEvent.click(dlg.getByLabelText('Move Conversations up'));
    await userEvent.click(dlg.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const grid = document.querySelector('[data-tour="digest-kpi-grid"]');
    const labels = within(grid).getAllByText(/^(Calls|Research notes|Meetings booked|Leads touched|Conversations)$/).map((n) => n.textContent);
    expect(labels).toEqual(['Calls', 'Research notes', 'Meetings booked', 'Conversations', 'Leads touched']);
    expect(within(grid).queryByText('Emails sent')).not.toBeInTheDocument();
    expect(screen.getByLabelText('View')).toHaveTextContent('Custom (not saved)');
  });

  it('a view holds at most 10 numbers and at least 1', async () => {
    render(<DailyDigestHub />);
    const dlg = await customize();
    for (const l of ['Conversations', 'Meetings held', 'New leads', 'Pipeline moved', 'Demos completed']) await userEvent.click(dlg.getByRole('checkbox', { name: l }));
    expect(dlg.getByText('Shown (10/10)')).toBeInTheDocument();
    expect(dlg.getByRole('checkbox', { name: 'Leads researched' })).toBeDisabled();
    for (const l of ['Calls', 'Emails sent', 'Research notes', 'Meetings booked', 'Leads touched', 'Conversations', 'Meetings held', 'New leads', 'Pipeline moved', 'Demos completed']) {
      await userEvent.click(dlg.getByLabelText(`Remove ${l}`));
    }
    expect(dlg.getByText('Pick at least one number.')).toBeInTheDocument();
    expect(dlg.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('Save View keeps the numbers (and the period) under a name, and the view then shows in the menu', async () => {
    SavedViewsService.create.mockResolvedValue({ id: 'v1', name: 'Weekly review', keys: ['calls_made', 'conversations'], filters: { period: 'yesterday' }, scope: 'digest' });
    render(<DailyDigestHub />);
    const dlg = await customize();
    expect(dlg.getByRole('button', { name: 'Save View' })).toBeDisabled();            // needs a name
    for (const l of ['Emails sent', 'Research notes', 'Meetings booked', 'Leads touched']) await userEvent.click(dlg.getByLabelText(`Remove ${l}`));
    await userEvent.click(dlg.getByRole('checkbox', { name: 'Conversations' }));
    await userEvent.type(dlg.getByLabelText('Save as a view (optional)'), 'Weekly review');
    await userEvent.click(dlg.getByRole('button', { name: 'Save View' }));
    await waitFor(() => expect(SavedViewsService.create).toHaveBeenCalledWith({
      scope: 'digest', name: 'Weekly review', keys: ['calls_made', 'conversations'], shared: false, filters: { period: 'yesterday' },
    }));
    await waitFor(() => expect(screen.getByLabelText('View')).toHaveTextContent('Weekly review'));
    expect(screen.getByLabelText('Delete view Weekly review')).toBeInTheDocument();
  });

  it('a name that is already taken is explained inside the dialog', async () => {
    SavedViewsService.create.mockRejectedValue({ response: { data: { detail: 'You already have a view called "Same".' } } });
    render(<DailyDigestHub />);
    const dlg = await customize();
    await userEvent.type(dlg.getByLabelText('Save as a view (optional)'), 'Same');
    await userEvent.click(dlg.getByRole('button', { name: 'Save View' }));
    expect(await dlg.findByRole('alert')).toHaveTextContent('already have a view called "Same"');
  });

  it('picking a saved view applies its numbers and its period; deleting asks first', async () => {
    SavedViewsService.list.mockResolvedValue([{ id: 'v1', name: 'Pipeline view', keys: ['new_leads', 'pipeline_moved'], filters: { period: 'last30' }, scope: 'digest' }]);
    SavedViewsService.remove.mockResolvedValue({});
    render(<DailyDigestHub />);
    await screen.findByLabelText('View');
    await waitFor(() => expect(SavedViewsService.list).toHaveBeenCalledWith('digest'));
    await userEvent.click(screen.getByLabelText('View'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pipeline view' }));
    await waitFor(() => expect(DailyDigestService.get).toHaveBeenLastCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String) }), ''));
    const grid = document.querySelector('[data-tour="digest-kpi-grid"]');
    expect(within(grid).getByText('New leads')).toBeInTheDocument();
    expect(within(grid).queryByText('Calls')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Delete view Pipeline view'));
    expect(SavedViewsService.remove).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(SavedViewsService.remove).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(screen.getByLabelText('View')).toHaveTextContent('Standard'));
  });

  // ── sharing a view with the team ───────────────────────────────────────────────────────────────────────────
  describe('shared views', () => {
    afterEach(() => { delete window.__CRM_CURRENT_USER__; });

    it('an admin sees the "Share with the whole team" switch and it is sent with the view', async () => {
      window.__CRM_CURRENT_USER__ = { role: 'Pod Admin' };
      SavedViewsService.create.mockResolvedValue({ id: 'v2', name: 'Team view', keys: ['calls_made'], filters: {}, scope: 'digest', shared: true, mine: true });
      render(<DailyDigestHub />);
      const dlg = await customize();
      await userEvent.type(dlg.getByLabelText('Save as a view (optional)'), 'Team view');
      await userEvent.click(dlg.getByRole('checkbox', { name: /Share with the whole team/ }));
      await userEvent.click(dlg.getByRole('button', { name: 'Save View' }));
      await waitFor(() => expect(SavedViewsService.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Team view', shared: true })));
    });

    it('a rep is not offered sharing', async () => {
      window.__CRM_CURRENT_USER__ = { role: 'SDR' };
      render(<DailyDigestHub />);
      const dlg = await customize();
      expect(dlg.queryByRole('checkbox', { name: /Share with the whole team/ })).not.toBeInTheDocument();
    });

    it('a view shared by someone else is usable, labelled, and cannot be deleted by a rep', async () => {
      window.__CRM_CURRENT_USER__ = { role: 'SDR' };
      SavedViewsService.list.mockResolvedValue([{ id: 'v3', name: 'Leadership', keys: ['new_leads'], filters: {}, scope: 'digest', shared: true, mine: false }]);
      render(<DailyDigestHub />);
      await screen.findByLabelText('View');
      await userEvent.click(screen.getByLabelText('View'));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Leadership (shared)' }));
      expect(await screen.findByText('Shared with team')).toBeInTheDocument();
      expect(screen.queryByLabelText('Delete view Leadership')).not.toBeInTheDocument();
    });
  });
});
