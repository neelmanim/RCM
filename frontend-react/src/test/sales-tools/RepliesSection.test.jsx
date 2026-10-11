import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replies = vi.fn();
const filters = vi.fn();
const reply = vi.fn();
const markRead = vi.fn();
const report = vi.fn();
const exportCsv = vi.fn();

vi.mock('../../services/api', () => ({
  InstantlyInboxService: {
    replies: (...a) => replies(...a), filters: (...a) => filters(...a), reply: (...a) => reply(...a),
    markRead: (...a) => markRead(...a), report: (...a) => report(...a),
  },
}));
vi.mock('../../features/activity-monitor/lib/exportCsv', () => ({ exportCsv: (...a) => exportCsv(...a) }));

import { RepliesSection } from '../../features/sales-tools/replies/RepliesSection';

const item = (o = {}) => ({
  id: 1, lead_id: 'L1', lead_name: 'Priya Shah', lead_company: 'Acme', subject: 'Re: Intro', snippet: 'Sounds good',
  from_email: 'priya@acme.com', mailbox: 'sdr@out.com', timestamp: '2026-10-06T10:00:00Z', unread: true,
  is_auto_reply: false, intent_label: 'Interested', positive: true, journey_id: 'j1', journey_name: 'Q4 Outreach',
  step: 2, rep_id: 'u1', rep_name: 'Dev', ...o,
});
const page = (items, extra = {}) => ({
  items, total: items.length, page: 1, per_page: 25, pages: 1,
  summary: { replies: items.length, positive: 1, reply_rate: 12.5, unread: 1, sent: 40 }, ...extra,
});

beforeEach(() => {
    window.__CRM_CAPS__ = { export: true };          // this user may export (the shell publishes it from /api/me/capabilities)
  [replies, filters, reply, markRead, report, exportCsv].forEach((m) => m.mockReset());
  filters.mockResolvedValue({ journeys: [{ id: 'j1', name: 'Q4 Outreach' }], reps: [], mailboxes: [], intents: [] });
  replies.mockResolvedValue(page([item(), item({ id: 2, lead_name: 'Sam Lee', unread: false, positive: false, intent_label: null })]));
  reply.mockResolvedValue({ ...item(), body: 'Happy to talk\nThursday?', to_email: 'sdr@out.com', thread: [{ id: 9, direction: 'outbound', subject: 'Intro', body: 'Hello there', timestamp: '2026-10-05T10:00:00Z', from_email: 'sdr@out.com', to_email: 'priya@acme.com' }] });
  markRead.mockResolvedValue({ id: 1, read_at: 'x' });
});

describe('RepliesSection — inbox', () => {
  it('shows a skeleton while loading, then the list and stat tiles', async () => {
    render(<RepliesSection userRole="SDR" />);
    expect(screen.getByRole('status', { name: 'Loading replies' })).toBeInTheDocument();
    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
    expect(replies).toHaveBeenCalledWith(expect.objectContaining({ page: 1, per_page: 25, sort: 'newest', include_auto: false }));
  });

  it('empty with nothing synced says what to do; empty with sent>0 says filters', async () => {
    replies.mockResolvedValueOnce(page([], { summary: { replies: 0, positive: 0, reply_rate: null, unread: 0, sent: 0 } }));
    const { unmount } = render(<RepliesSection userRole="SDR" />);
    expect(await screen.findByText('No Instantly emails synced yet')).toBeInTheDocument();
    unmount();
    replies.mockResolvedValueOnce(page([], { summary: { replies: 0, positive: 0, reply_rate: 0, unread: 0, sent: 10 } }));
    render(<RepliesSection userRole="SDR" />);
    expect(await screen.findByText('No replies match these filters')).toBeInTheDocument();
  });

  it('shows the backend detail on error and Retry refetches', async () => {
    replies.mockRejectedValueOnce({ response: { data: { detail: 'Instantly plan does not allow this' } } });
    const user = userEvent.setup();
    render(<RepliesSection userRole="SDR" />);
    expect(await screen.findByText(/Instantly plan does not allow this/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
  });

  it('Apply sends the filters; Unread only and include-out-of-office map to params', async () => {
    const user = userEvent.setup();
    render(<RepliesSection userRole="SDR" />);
    await screen.findByText('Priya Shah');
    await user.type(screen.getByLabelText('Search replies'), 'acme');
    await user.click(screen.getByLabelText('Include out-of-office'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(replies).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'acme', include_auto: true, page: 1 })));
    await user.click(screen.getByLabelText('Unread only'));
    await waitFor(() => expect(replies).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unread', search: 'acme' })));
  });

  it('opens a reply in the reader (plain text, thread) and optimistically marks it read', async () => {
    const user = userEvent.setup();
    render(<RepliesSection userRole="SDR" />);
    await user.click(await screen.findByText('Priya Shah'));
    const reader = await screen.findByLabelText('Reply reader');
    expect(await within(reader).findByText(/Happy to talk/)).toBeInTheDocument();
    expect(within(reader).getByText(/1 earlier message/)).toBeInTheDocument();
    expect(reply).toHaveBeenCalledWith(1);
    expect(markRead).not.toHaveBeenCalled();                        // arrowing past / a glance doesn't mark it read…
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(1, true, true), { timeout: 3000 });   // …staying on it does (implicit)
    await waitFor(() => expect(screen.queryByTestId('unread-dot')).not.toBeInTheDocument());
  });

  it('stays unread when the server ignores an implicit open (the viewer is not the lead\'s rep)', async () => {
    markRead.mockResolvedValue({ id: 1, read_at: null });
    const user = userEvent.setup();
    render(<RepliesSection />);
    await user.click(await screen.findByText('Priya Shah'));
    await waitFor(() => expect(markRead).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.getByTestId('unread-dot')).toBeInTheDocument();
  });

  it('an explicit Mark read click is not implicit', async () => {
    const user = userEvent.setup();
    render(<RepliesSection />);
    await user.click(await screen.findByText('Priya Shah'));
    await user.click(await screen.findByRole('button', { name: /Mark (as )?read/i }));
    expect(markRead).toHaveBeenCalledWith(1, true, false);
  });

  it('reverts the unread state and toasts when marking read fails', async () => {
    markRead.mockRejectedValue({ response: { data: { detail: 'nope' } } });
    const toasts = [];
    window.addEventListener('alternate:toast', (e) => toasts.push(e.detail));
    const user = userEvent.setup();
    render(<RepliesSection userRole="SDR" />);
    await user.click(await screen.findByText('Priya Shah'));
    await waitFor(() => expect(toasts.some((t) => /nope/.test(t.message))).toBe(true), { timeout: 3000 });
    expect(screen.getByTestId('unread-dot')).toBeInTheDocument();
  });

  it('arrow keys move selection and Enter opens', async () => {
    const user = userEvent.setup();
    render(<RepliesSection userRole="SDR" />);
    await screen.findByText('Priya Shah');
    screen.getByRole('listbox', { name: 'Replies' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(reply).toHaveBeenCalledWith(2));
  });

  it('exports the current page as CSV from the reader', async () => {
    const user = userEvent.setup();
    render(<RepliesSection userRole="SDR" />);
    await user.click(await screen.findByText('Priya Shah'));
    await user.click(await screen.findByRole('button', { name: /Export page as CSV/ }));
    expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({ rows: expect.arrayContaining([expect.objectContaining({ id: 1 })]), filenamePrefix: 'instantly-replies' }));
  });
});

describe('RepliesSection — report and gating', () => {
  it('report tab loads by cadence and refetches on group-by change', async () => {
    report.mockResolvedValue({
      group_by: 'cadence',
      rows: [{ key: 'j1', label: 'Q4 Outreach', sent: 100, contacted: 80, replied: 10, positive: 3, reply_rate: 12.5, positive_rate: 3.75, opens: 50, clicks: 5 }],
      totals: { sent: 100, contacted: 80, replied: 10, positive: 3, reply_rate: 12.5, positive_rate: 3.75, opens: 50, clicks: 5 },
    });
    const user = userEvent.setup();
    render(<RepliesSection userRole="Super Admin" />);
    await screen.findByText('Priya Shah');
    await user.click(screen.getByRole('button', { name: 'Report' }));
    expect(await screen.findByText('Q4 Outreach')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(report).toHaveBeenCalledWith({ group_by: 'cadence' });
    await user.click(screen.getByRole('button', { name: 'Group by' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mailbox' }));
    await waitFor(() => expect(report).toHaveBeenLastCalledWith({ group_by: 'mailbox' }));
  });

  it('report empty and error states', async () => {
    report.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<RepliesSection userRole="AE" />);
    await screen.findByText('Priya Shah');
    await user.click(screen.getByRole('button', { name: 'Report' }));
    expect(await screen.findByText(/Couldn't load the report: boom/)).toBeInTheDocument();
    report.mockResolvedValueOnce({ group_by: 'cadence', rows: [], totals: {} });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No Instantly activity in this range')).toBeInTheDocument();
  });

});
