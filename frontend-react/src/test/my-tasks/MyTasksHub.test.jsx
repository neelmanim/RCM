import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyTasksHub } from '../../features/my-tasks/MyTasksHub';
import { TasksService, LeadsService } from '../../services/api';

vi.mock('../../services/api', () => ({
  TasksService: { getMine: vi.fn(), snooze: vi.fn() },
  LeadsService: { patchTask: vi.fn(), deleteTask: vi.fn(), skipTask: vi.fn() },
}));

const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();

const openTask = { id: 't1', title: 'Call about renewal', done: false, due_date: null, due_time: null, lead_id: 'l1', lead_name: 'Priya Shah', lead_company: 'Acme' };
const overdueTask = { id: 't2', title: 'Follow up', done: false, due_time: '2020-01-01T10:00:00Z', lead_id: 'l2', lead_name: 'Rohan', lead_company: null };
const approval = {
  id: 't9', title: '[Demo Cadence] Review & send email: Priya Shah', done: false, kind: 'email_approval',
  from_cadence: true, due_time: inHours(24), lead_id: 'l1', lead_name: 'Priya Shah', lead_company: 'Acme',
  draft_subject: 'Hi Priya', draft_body: 'Following up.', draft_body_format: 'text',
};
const linkedin = {
  id: 't10', title: '[Demo Cadence] Connect with Priya on LinkedIn', done: false, from_cadence: true, due_time: inHours(30),
  lead_id: 'l1', lead_name: 'Priya Shah', description: 'Say hi', outcome_options: [{ key: 'accepted', label: 'Accepted' }],
};

let toasts;
const onToast = (e) => toasts.push(e.detail);

beforeEach(() => {
  window.localStorage.setItem('alternate:my-tasks-tour-seen', '1');
  toasts = [];
  window.addEventListener('alternate:toast', onToast);
  TasksService.getMine.mockResolvedValue([openTask]);
  LeadsService.patchTask.mockResolvedValue({});
  LeadsService.deleteTask.mockResolvedValue({});
  LeadsService.skipTask.mockResolvedValue({});
  TasksService.snooze.mockResolvedValue({});
});
afterEach(() => window.removeEventListener('alternate:toast', onToast));

const openMenu = async (user, row) => user.click(within(row).getByRole('button', { name: 'Task actions' }));
const rowOf = (text) => screen.getByText(text).closest('[data-tour="task-row"]');

describe('MyTasksHub — layout', () => {
  it('loads open tasks and shows lead context, cadence and type', async () => {
    TasksService.getMine.mockResolvedValue([openTask, linkedin]);
    render(<MyTasksHub />);
    await waitFor(() => expect(TasksService.getMine).toHaveBeenCalledWith('open'));
    expect(await screen.findByText('Call about renewal')).toBeInTheDocument();
    expect(screen.getAllByText(/Priya Shah/).length).toBeGreaterThan(0);
    // The cadence name moves out of the title into the meta line, with a type badge.
    expect(screen.getByText('Connect with Priya on LinkedIn')).toBeInTheDocument();
    expect(screen.getByText('Cadence step')).toBeInTheDocument();
    expect(screen.getByText(/Demo Cadence/)).toBeInTheDocument();
  });

  it('opens on Approvals when drafts are waiting, with the count in the tab', async () => {
    TasksService.getMine.mockResolvedValue([openTask, approval]);
    render(<MyTasksHub />);
    expect(await screen.findByLabelText('Email subject')).toHaveValue('Hi Priya');
    expect(screen.getByRole('button', { name: /Approvals \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /To do \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByText('Call about renewal')).not.toBeInTheDocument();
  });

  it('a just-created approval reads "Due in …", never "Overdue"', async () => {
    TasksService.getMine.mockResolvedValue([approval]);
    render(<MyTasksHub />);
    await screen.findByLabelText('Email subject');
    expect(screen.getByText(/Due (tomorrow|in)/)).toBeInTheDocument();
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it('groups To do by when it is due', async () => {
    TasksService.getMine.mockResolvedValue([openTask, overdueTask]);
    render(<MyTasksHub />);
    await screen.findByText('Follow up');
    expect(screen.getByRole('heading', { name: /Overdue/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /No due date/ })).toBeInTheDocument();
    expect(screen.getByText(/Overdue by/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is open', async () => {
    TasksService.getMine.mockResolvedValue([]);
    render(<MyTasksHub />);
    expect(await screen.findByText('Nothing to do right now')).toBeInTheDocument();
  });

  it('the Done tab loads completed tasks', async () => {
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByText('Call about renewal');
    TasksService.getMine.mockResolvedValue([{ ...openTask, id: 'd1', title: 'Old task', done: true }]);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(TasksService.getMine).toHaveBeenCalledWith('done'));
    expect(await screen.findByText('Old task')).toBeInTheDocument();
  });

  it('opens on the tab it was navigated to (the bell opens Approvals)', async () => {
    TasksService.getMine.mockResolvedValue([openTask]);
    render(<MyTasksHub initialTab="approvals" />);
    expect(await screen.findByText('No approvals waiting')).toBeInTheDocument();
  });

  it('a repeat bell click while mounted switches back to Approvals', async () => {
    TasksService.getMine.mockResolvedValue([openTask, approval]);
    const user = userEvent.setup();
    const { rerender } = render(<MyTasksHub initialTab="approvals" navAt={1} />);
    await screen.findByLabelText('Email subject');
    await user.click(screen.getByRole('button', { name: /To do/ }));
    expect(await screen.findByText('Call about renewal')).toBeInTheDocument();
    rerender(<MyTasksHub initialTab="approvals" navAt={2} />);   // same tab, new navigation
    expect(await screen.findByLabelText('Email subject')).toBeInTheDocument();
  });

  it('loads once on first open, not twice', async () => {
    TasksService.getMine.mockClear();
    render(<MyTasksHub initialTab="approvals" navAt={1} />);
    await screen.findByText('No approvals waiting');
    expect(TasksService.getMine).toHaveBeenCalledTimes(1);
  });

  it('a failed Done load says so instead of "Nothing completed yet"', async () => {
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByText('Call about renewal');
    TasksService.getMine.mockRejectedValue(new Error('503'));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Couldn’t load your tasks')).toBeInTheDocument();
  });

  it('shows a load error without crashing', async () => {
    TasksService.getMine.mockRejectedValue(new Error('network'));
    render(<MyTasksHub />);
    expect(await screen.findByText('Couldn’t load your tasks')).toBeInTheDocument();
  });

  it('search filters by lead name, company, or task title', async () => {
    TasksService.getMine.mockResolvedValue([openTask, overdueTask]);
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByText('Call about renewal');
    await user.type(screen.getByLabelText('Search tasks'), 'Acme');
    expect(screen.getByText('Call about renewal')).toBeInTheDocument();
    expect(screen.queryByText('Follow up')).not.toBeInTheDocument();
  });
});

describe('MyTasksHub — actions', () => {
  it('ticking a task off is immediate and saved', async () => {
    let resolvePatch;
    LeadsService.patchTask.mockReturnValue(new Promise((r) => { resolvePatch = r; }));
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByText('Call about renewal');
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(LeadsService.patchTask).toHaveBeenCalledWith('l1', 't1', { done: true });
    resolvePatch({});
  });

  it('reverts the tick and says why if saving fails', async () => {
    LeadsService.patchTask.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByText('Call about renewal');
    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(toasts.some((t) => t.type === 'error')).toBe(true));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('clicking the lead name navigates via onLeadClick', async () => {
    const user = userEvent.setup();
    const onLeadClick = vi.fn();
    render(<MyTasksHub onLeadClick={onLeadClick} />);
    await screen.findByText('Call about renewal');
    await user.click(screen.getByRole('button', { name: /Priya Shah · Acme/ }));
    expect(onLeadClick).toHaveBeenCalledWith('l1');
  });

  it('a regular task is deleted after confirming', async () => {
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByText('Call about renewal');
    await openMenu(user, rowOf('Call about renewal'));
    await user.click(screen.getByRole('menuitem', { name: /Delete task/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(LeadsService.deleteTask).toHaveBeenCalledWith('l1', 't1'));
  });

  it('a cadence step offers Skip, not Delete, and skips after confirming', async () => {
    TasksService.getMine.mockResolvedValue([linkedin]);
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByText('Connect with Priya on LinkedIn');
    await openMenu(user, rowOf('Connect with Priya on LinkedIn'));
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /Skip this step/ }));
    await user.click(screen.getByRole('button', { name: 'Skip step' }));
    await waitFor(() => expect(LeadsService.skipTask).toHaveBeenCalledWith('l1', 't10'));
  });

  it('an approval cannot be snoozed — the cadence is paused on it', async () => {
    TasksService.getMine.mockResolvedValue([approval]);
    const user = userEvent.setup();
    render(<MyTasksHub initialTab="approvals" />);
    await screen.findByLabelText('Email subject');
    await openMenu(user, screen.getByLabelText('Email subject').closest('[data-tour="task-row"]'));
    expect(screen.queryByRole('menuitem', { name: /Snooze/ })).not.toBeInTheDocument();
  });

  it('snoozing until tomorrow sends a date, not minutes', async () => {
    TasksService.getMine.mockResolvedValue([overdueTask]);
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByText('Follow up');
    await openMenu(user, rowOf('Follow up'));
    await user.click(screen.getByRole('menuitem', { name: /tomorrow/ }));
    await waitFor(() => expect(TasksService.snooze).toHaveBeenCalledWith('t2', { until: expect.any(String) }));
  });

  it('a refused draft approval shows the server reason and keeps the edited draft on screen', async () => {
    TasksService.getMine.mockResolvedValue([approval]);
    const detail = "Can't send yet: No connected mailbox for Riya Rep. Your draft is kept — fix this, then send again.";
    LeadsService.patchTask.mockRejectedValue({ response: { status: 409, data: { detail } } });
    const user = userEvent.setup();
    render(<MyTasksHub />);
    const subject = await screen.findByLabelText('Email subject');
    await user.clear(subject);
    await user.type(subject, 'Edited subject');
    await user.click(screen.getByRole('button', { name: 'Send email' }));
    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(screen.getByLabelText('Email subject')).toHaveValue('Edited subject');
  });

  it('sending a draft confirms and refreshes', async () => {
    TasksService.getMine.mockResolvedValueOnce([approval]).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<MyTasksHub />);
    await screen.findByLabelText('Email subject');
    await user.click(screen.getByRole('button', { name: 'Send email' }));
    await waitFor(() => expect(LeadsService.patchTask).toHaveBeenCalledWith('l1', 't9', { done: true, subject: 'Hi Priya', body: 'Following up.' }));
    await waitFor(() => expect(toasts.some((t) => /on its way/.test(t.message))).toBe(true));
  });
});
