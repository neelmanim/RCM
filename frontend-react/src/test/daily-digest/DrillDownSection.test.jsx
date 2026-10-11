import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DrillDownSection } from '../../features/daily-digest/DrillDownSection';
import { DigestDrillService } from '../../services/api';
import { toast } from '../../features/control-center/notify';

vi.mock('../../services/api', () => ({
  DigestDrillService: { breakdown: vi.fn(), accounts: vi.fn(), calls: vi.fn(), getIcp: vi.fn(), setIcp: vi.fn(), exportXlsx: vi.fn(), leads: vi.fn() },
}));
vi.mock('../../features/control-center/notify', () => ({ toast: vi.fn(), errorText: (e) => e?.response?.data?.detail || 'failed' }));

const RANGE = { from: '2026-09-01', to: '2026-09-07' };
const ROW = (label, leads, delta = { leads: 10, calls: 25, conversations: -50, booked: 'new' }) => ({
  label, leads, accounts: leads, calls: 10, conversations: 4, connect_rate: 40, emails: 3, notes: 0, booked: 1, held: 1, no_show: 0, leads_spoken_to: 2,
  lead_to_conversation: 50, booked_per_100_conversations: 25, held_rate: 100, thin: {}, prev: { leads: 6, calls: 8, conversations: 8, booked: 0 }, delta,
});
const SEGMENT = {
  dimension: 'icp', label: 'ICP fit', icp_keywords: ['health'], more: 0, compared: true, compare_label: 'the previous 7 days', unclassified_titles: [],
  rows: [ROW('In ICP', 7), ROW('Outside ICP', 3, { leads: null, calls: 0, conversations: -100, booked: null }), ROW('Industry not filled in', 2), { ...ROW('No lead on record', 0), leads: 0 }], total: ROW('Total', 12), coverage: { leads: 12, filled: 10, pct: 83 },
};
const ACCOUNTS = {
  rows: [{ key: 'stmary.org', account: 'St Mary Hospital', people_tried: 3, people_spoke: 2, calls: 6, conversations: 2, emails: 1, booked: 1, held: 0, stage: 'Meeting booked' }], more: 0,
  summary: { accounts: 1, people_per_account: 3, spoke_to_two_or_more: 1, stages: { 'Meeting booked': 1, 'Spoke, no meeting': 0, 'Tried, not reached': 0, 'Email / notes only': 0 } },
};
const CALLS = {
  total: 20, conversations: 8, connect_rate: 40, timezone: 'Asia/Kolkata', outcomes: [{ outcome: 'No Answer', calls: 12 }, { outcome: 'Interested', calls: 8 }],
  by_hour: [{ hour: 10, calls: 20, conversations: 8, connect_rate: 40 }], conversation_lengths: [{ band: 'Under 30s', conversations: 1 }, { band: '1-3 min', conversations: 7 }],
};

describe('DrillDownSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__CRM_CURRENT_USER__ = { role: 'Super Admin' };
    window.__CRM_CAPS__ = { export: true };
    DigestDrillService.breakdown.mockResolvedValue(SEGMENT);
    DigestDrillService.accounts.mockResolvedValue(ACCOUNTS);
    DigestDrillService.calls.mockResolvedValue(CALLS);
    DigestDrillService.getIcp.mockResolvedValue({ keywords: ['health'] });
    DigestDrillService.setIcp.mockResolvedValue({ keywords: ['bank'] });
  });

  it('starts on ICP fit for the Digest period and shows what is missing, last and flagged', async () => {
    render(<DrillDownSection podId="p1" range={RANGE} />);
    expect(await screen.findByText('In ICP')).toBeInTheDocument();
    expect(DigestDrillService.breakdown).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-07', pod_id: 'p1', dimension: 'icp' });
    expect(screen.getByText('Missing data')).toBeInTheDocument();
    expect(screen.getByText(/2 of 12 leads worked have no icp fit on record/i)).toBeInTheDocument();
    expect(screen.getByText(/ICP = industry contains: health/)).toBeInTheDocument();
  });

  it('waits for the Digest period before asking anything', () => {
    render(<DrillDownSection podId="" range={null} />);
    expect(DigestDrillService.breakdown).not.toHaveBeenCalled();
  });

  it('Accounts and Calls tabs load their own views', async () => {
    const user = userEvent.setup();
    render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    await user.click(document.querySelector('[data-tab="accounts"]'));
    expect(await screen.findByText('St Mary Hospital')).toBeInTheDocument();
    expect(screen.getByText('Meeting booked', { selector: 'span' })).toBeInTheDocument();
    await user.click(document.querySelector('[data-tab="calls"]'));
    expect(await screen.findByText('No Answer')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText(/Calls by hour \(Asia\/Kolkata\)/)).toBeInTheDocument();
  });

  it('a refusal or an empty period gets a clear message, not a blank card', async () => {
    DigestDrillService.breakdown.mockResolvedValueOnce({ error: 'Date must be in the past.' });
    const { unmount } = render(<DrillDownSection podId="" range={RANGE} />);
    expect(await screen.findByText('Date must be in the past.')).toBeInTheDocument();
    unmount();
    DigestDrillService.breakdown.mockResolvedValueOnce({ ...SEGMENT, rows: [] });
    render(<DrillDownSection podId="" range={RANGE} />);
    expect(await screen.findByText('No activity')).toBeInTheDocument();
  });

  it('a Super Admin edits the ICP words and the table reloads; others never see the button', async () => {
    const user = userEvent.setup();
    render(<DrillDownSection podId="" range={RANGE} />);
    await user.click(await screen.findByRole('button', { name: /Edit ICP/ }));
    const dlg = within(await screen.findByRole('dialog'));
    const input = await dlg.findByLabelText(/Industry words/);
    await waitFor(() => expect(input).toHaveValue('health'));
    await user.clear(input);
    await user.type(input, 'bank, fintech');
    await user.click(dlg.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(DigestDrillService.setIcp).toHaveBeenCalledWith(['bank', 'fintech']));
    await waitFor(() => expect(DigestDrillService.breakdown).toHaveBeenCalledTimes(2));
  });

  it('a Pod Admin has no Edit ICP button, and a refused save keeps the dialog open with the reason', async () => {
    window.__CRM_CURRENT_USER__ = { role: 'Pod Admin' };
    const { unmount } = render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    expect(screen.queryByRole('button', { name: /Edit ICP/ })).toBeNull();
    unmount();
    window.__CRM_CURRENT_USER__ = { role: 'Super Admin' };
    DigestDrillService.setIcp.mockRejectedValueOnce({ response: { data: { detail: 'Give between 1 and 30 industry words.' } } });
    const user = userEvent.setup();
    render(<DrillDownSection podId="" range={RANGE} />);
    await user.click(await screen.findByRole('button', { name: /Edit ICP/ }));
    const dlg = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dlg.getByLabelText(/Industry words/)).toHaveValue('health'));
    await user.click(dlg.getByRole('button', { name: 'Save' }));
    expect(await dlg.findByRole('alert')).toHaveTextContent('Give between 1 and 30 industry words.');
  });

  it('shows conversion and the change against the previous period beside each number', async () => {
    render(<DrillDownSection podId="" range={RANGE} />);
    const row = (await screen.findByText('In ICP')).closest('tr');
    expect(within(row).getByText('▲ 25%')).toBeInTheDocument();          // calls
    expect(within(row).getByText('▼ 50%')).toBeInTheDocument();          // conversations
    expect(within(row).getByText('new')).toBeInTheDocument();            // booked, nothing before
    expect(within(row).getByText('▲ 10%')).toBeInTheDocument();          // leads
        expect(screen.getByText(/compare with the previous 7 days/)).toBeInTheDocument();
    expect(screen.queryByText('Leads spoken to %')).toBeNull();          // the short list first
    await userEvent.setup().click(screen.getByRole('button', { name: 'More columns' }));
    expect(screen.getByText('Leads spoken to %')).toBeInTheDocument();
    expect(screen.getByText('Held %')).toBeInTheDocument();
    const quiet = screen.getByText('Outside ICP').closest('tr');
    expect(within(quiet).getByText('0%')).toBeInTheDocument();           // zero change reads 0%, not blank
    expect(within(quiet).getByText('▼ 100%')).toBeInTheDocument();
  });

  it('shows no change markers when the comparison is off', async () => {
    DigestDrillService.breakdown.mockResolvedValue({ ...SEGMENT, compared: false, rows: SEGMENT.rows.map(({ prev, delta, ...r }) => r) });
    render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    expect(screen.queryByText('▲ 25%')).toBeNull();
    expect(screen.queryByText(/compare with/)).toBeNull();
  });

  it('Export sends the period, pod and breakdown, and says why when it is refused', async () => {
    const user = userEvent.setup();
    DigestDrillService.exportXlsx.mockResolvedValue();
    render(<DrillDownSection podId="p1" range={RANGE} />);
    await screen.findByText('In ICP');
    await user.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(DigestDrillService.exportXlsx).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-07', pod_id: 'p1', dimension: 'icp' }));
    DigestDrillService.exportXlsx.mockRejectedValueOnce({ response: { data: { detail: 'Data export is not switched on for you.' } } });
    await user.click(screen.getByRole('button', { name: /Export/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Data export is not switched on for you.', 'error'));
  });

  it('nobody without export access is offered the Export button', async () => {
    window.__CRM_CAPS__ = { export: false };
    render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });

  it('a rate built on few calls is shown quietly with the reason', async () => {
    DigestDrillService.breakdown.mockResolvedValue({ ...SEGMENT, rows: [{ ...ROW('India', 5), thin: { connect_rate: true, booked_per_100_conversations: true } }] });
    render(<DrillDownSection podId="" range={RANGE} />);
    const row = (await screen.findByText('India')).closest('tr');
    const quiet = within(row).getAllByTitle(/Too few/);
    expect(quiet.map((e) => e.textContent)).toEqual(['40', '25']);
    expect(quiet[0]).toHaveClass('text-slate-400');
    expect(quiet[0].title).toBe('Too few calls for this to mean much');
    expect(quiet[1].title).toBe('Too few conversations for this to mean much');
  });

  it('More columns adds the rest and Fewer columns takes them away again', async () => {
    const user = userEvent.setup();
    render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    for (const h of ['Accounts', 'Emails', 'Held', 'Held %']) expect(screen.queryByRole('columnheader', { name: new RegExp(`^${h}$`) })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More columns' }));
    for (const h of ['Accounts', 'Emails', 'Held', 'Held %']) expect(screen.getByRole('columnheader', { name: new RegExp(`^${h}$`) })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fewer columns' }));
    expect(screen.queryByRole('columnheader', { name: /^Emails/ })).toBeNull();
  });

  it('clicking a row lists the leads behind it, and a lead opens from there', async () => {
    const user = userEvent.setup();
    window._loadView = vi.fn();
    DigestDrillService.leads.mockResolvedValue({ total: 150, more: 50, rows: [
      { lead_id: 'L1', name: 'Asha Rao', company: 'St Mary', title: 'CMO', status: 'Calling', calls: 3, emails: 0, conversations: 1, booked: 1, held: 0 },
    ] });
    render(<DrillDownSection podId="p1" range={RANGE} />);
    await user.click(await screen.findByRole('row', { name: 'Show the leads for In ICP' }));
    expect(DigestDrillService.leads).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-07', pod_id: 'p1', dimension: 'icp', segment: 'In ICP' });
    const dlg = within(await screen.findByRole('dialog'));
    expect(await dlg.findByText('Asha Rao')).toBeInTheDocument();
    expect(dlg.getByText(/Showing the 1 most worked of 150 leads/)).toBeInTheDocument();
    await user.click(dlg.getByText('Asha Rao'));
    expect(window._loadView).toHaveBeenCalledWith('lead-detail', 'L1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the row for calls with no live lead is not clickable; a failed lead list says so', async () => {
    const user = userEvent.setup();
    render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    expect(screen.queryByRole('row', { name: /Show the leads for No lead on record/ })).toBeNull();
    expect(screen.getByText('Calls with no live lead')).toBeInTheDocument();
    DigestDrillService.leads.mockResolvedValue({ error: 'Date must be in the past.' });
    await user.click(screen.getByRole('row', { name: 'Show the leads for Outside ICP' }));
    expect(await screen.findByText('Could not load the leads')).toBeInTheDocument();
  });

  it('Accounts: choose a stage to list only those accounts; an account opens its people', async () => {
    const user = userEvent.setup();
    DigestDrillService.leads.mockResolvedValue({ total: 1, more: 0, rows: [{ lead_id: 'L9', name: 'Ravi K', company: 'St Mary Hospital', title: '', status: 'Calling', calls: 2, emails: 0, conversations: 0, booked: 0, held: 0 }] });
    render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    await user.click(document.querySelector('[data-tab="accounts"]'));
    await user.click(await screen.findByRole('row', { name: 'Show the people at St Mary Hospital' }));
    expect(DigestDrillService.leads).toHaveBeenCalledWith(expect.objectContaining({ account: 'stmary.org' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByLabelText('Show accounts at stage'));
    await user.click(await screen.findByRole('menuitem', { name: /Spoke, no meeting \(0\)/ }));
    await waitFor(() => expect(DigestDrillService.accounts).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'Spoke, no meeting' })));
  });

  it('an empty stage says so instead of showing an empty table', async () => {
    const user = userEvent.setup();
    DigestDrillService.accounts.mockResolvedValueOnce(ACCOUNTS).mockResolvedValue({ ...ACCOUNTS, rows: [], stage: 'Spoke, no meeting' });
    render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    await user.click(document.querySelector('[data-tab="accounts"]'));
    await screen.findByText('St Mary Hospital');
    await user.click(screen.getByLabelText('Show accounts at stage'));
    await user.click(await screen.findByRole('menuitem', { name: /Spoke, no meeting/ }));
    expect(await screen.findByText('No accounts at this stage')).toBeInTheDocument();
  });

  it('Calls sends the browser time zone when no pod is chosen, and not when one is', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    await user.click(document.querySelector('[data-tab="calls"]'));
    await waitFor(() => expect(DigestDrillService.calls).toHaveBeenCalledWith(expect.objectContaining({ tz: expect.any(String) })));
    unmount();
    DigestDrillService.calls.mockClear();
    render(<DrillDownSection podId="p1" range={RANGE} />);
    await screen.findByText('In ICP');
    await user.click(document.querySelector('[data-tab="calls"]'));
    await waitFor(() => expect(DigestDrillService.calls).toHaveBeenCalled());
    expect(DigestDrillService.calls.mock.calls[0][0].tz).toBeUndefined();
  });

  it('waits until the card is on screen before asking for anything', async () => {
    let fire;
    const real = global.IntersectionObserver;
    global.IntersectionObserver = class { constructor(cb) { fire = cb; } observe() {} disconnect() {} };
    try {
      render(<DrillDownSection podId="" range={RANGE} />);
      expect(DigestDrillService.breakdown).not.toHaveBeenCalled();
      fire([{ isIntersecting: false }]);
      expect(DigestDrillService.breakdown).not.toHaveBeenCalled();
      fire([{ isIntersecting: true }]);
      await screen.findByText('In ICP');
      expect(DigestDrillService.breakdown).toHaveBeenCalledTimes(1);
    } finally {
      global.IntersectionObserver = real;
    }
  });

  it('a new period keeps the old numbers on screen (dimmed) until the new ones arrive', async () => {
    let release;
    const { rerender } = render(<DrillDownSection podId="" range={RANGE} />);
    await screen.findByText('In ICP');
    DigestDrillService.breakdown.mockReturnValueOnce(new Promise((r) => { release = r; }));
    rerender(<DrillDownSection podId="" range={{ from: '2026-08-01', to: '2026-08-07' }} />);
    expect(screen.getByText('In ICP')).toBeInTheDocument();                       // not blanked, not a skeleton
    expect(document.querySelector('[aria-busy="true"]')).toHaveClass('opacity-50');
    release({ ...SEGMENT, rows: [ROW('Only now', 1)] });
    expect(await screen.findByText('Only now')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="false"]')).toHaveClass('opacity-100');
  });
});
