import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavTopbar } from '../../layout/NavTopbar';

// NavTopbar's NotificationBell reads task/reply data from window-level
// bridge functions set by the legacy vanilla app.js (see app.js's
// window._fetchPendingTasks / window._fetchPendingReplies) — not props.
vi.mock('../../features/aircall-everywhere/useAircallEverywhere', () => ({
  useAircallEverywhere: () => ({ status: 'ineligible', callActive: false }),
  OPT_OUT_KEY: 'aircall_everywhere_pref',
  CONTAINER_ID: 'aircall-everywhere-mount',
}));

describe('NavTopbar — NotificationBell (v11.3.0 reply notifications)', () => {
  const noop = () => {};

  beforeEach(() => {
    window._fetchPendingTasks = vi.fn().mockResolvedValue([
      { id: 't1', title: 'Follow up', due_time: null },
    ]);
    window._fetchPendingReplies = vi.fn().mockResolvedValue([
      { id: 'r1', title: 'Re: Demo', due_time: null, lead_name: 'Priya Sharma', lead_company: 'Acme' },
    ]);
    window._dismissTask = vi.fn().mockResolvedValue({});
    window._dismissReply = vi.fn().mockResolvedValue({});
  });

  afterEach(() => {
    delete window._fetchPendingTasks;
    delete window._fetchPendingReplies;
    delete window._dismissTask;
    delete window._dismissReply;
  });

  it('combines tasks and replies into one badge count', async () => {
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    await waitFor(() => expect(window._fetchPendingReplies).toHaveBeenCalled());
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  it('shows replies under their own section, separate from tasks', async () => {
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    await waitFor(() => expect(window._fetchPendingReplies).toHaveBeenCalled());
    await userEvent.click(document.getElementById('nh-notification-bell-btn'));

    expect(screen.getByText('Replies')).toBeInTheDocument();
    expect(screen.getByText('Due tasks')).toBeInTheDocument();
    expect(screen.getByText('Re: Demo')).toBeInTheDocument();
    expect(screen.getByText('Priya Sharma · Acme')).toBeInTheDocument();
  });

  it('dismissing a reply removes it and lowers the count', async () => {
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    await waitFor(() => expect(window._fetchPendingReplies).toHaveBeenCalled());
    await userEvent.click(document.getElementById('nh-notification-bell-btn'));

    await userEvent.click(screen.getByRole('button', { name: 'Mark reply as read' }));
    await waitFor(() => expect(window._dismissReply).toHaveBeenCalledWith('r1'));
    expect(screen.queryByText('Re: Demo')).not.toBeInTheDocument();
  });

  it('still works when only pending replies exist (no tasks)', async () => {
    window._fetchPendingTasks = vi.fn().mockResolvedValue([]);
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    await waitFor(() => expect(window._fetchPendingReplies).toHaveBeenCalled());
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('v13.7.0: approvals get their own section, open My Tasks on Approvals, and feed the nav badge', async () => {
    window._fetchPendingTasks = vi.fn().mockResolvedValue([
      { id: 'a1', title: '[Demo] Review & send email: Asha Rao', kind: 'email_approval', lead_id: 'l1', lead_name: 'Asha Rao',
        due_time: new Date(Date.now() + 24 * 3600e3).toISOString() },
    ]);
    window._loadView = vi.fn();
    const counts = [];
    const onCounts = (e) => counts.push(e.detail.approvals);
    window.addEventListener('alternate:task-counts', onCounts);
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    await waitFor(() => expect(counts).toContain(1));
    await userEvent.click(document.getElementById('nh-notification-bell-btn'));
    expect(screen.getByText('Approvals waiting')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Review & send email: Asha Rao'));
    expect(window._loadView).toHaveBeenCalledWith('my-tasks', 'approvals');
    window.removeEventListener('alternate:task-counts', onCounts);
    delete window._loadView;
  });

  it('v13.7.0: a reply opens its lead', async () => {
    window._fetchPendingReplies = vi.fn().mockResolvedValue([
      { id: 'r1', title: 'Re: Demo', lead_id: 'l9', lead_name: 'Priya Sharma', due_time: null },
    ]);
    window._loadView = vi.fn();
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    await waitFor(() => expect(window._fetchPendingReplies).toHaveBeenCalled());
    await userEvent.click(document.getElementById('nh-notification-bell-btn'));
    await userEvent.click(screen.getByText('Re: Demo'));
    expect(window._loadView).toHaveBeenCalledWith('lead-detail', 'l9');
    delete window._loadView;
  });

  it('v13.7.0: Enter on "Mark as read" marks it read without also opening the lead', async () => {
    window._loadView = vi.fn();
    const user = userEvent.setup();
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    await waitFor(() => expect(window._fetchPendingReplies).toHaveBeenCalled());
    await user.click(document.getElementById('nh-notification-bell-btn'));
    screen.getByRole('button', { name: 'Mark reply as read' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window._dismissReply).toHaveBeenCalledWith('r1'));
    expect(window._loadView).not.toHaveBeenCalled();
    delete window._loadView;
  });
});
