import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CadenceTaskDetails } from '../../components/CadenceTaskDetails';

// v13.1.0 manual-email cadence step (Viren's request) — the one place
// completing a task means editing and sending something, not just picking
// an outcome. Covers the branch this added to the shared component every
// Task-rendering surface (Lead Detail, My Tasks) goes through.
describe('CadenceTaskDetails — manual email approval', () => {
  const draftTask = {
    id: 't1', done: false, kind: 'email_approval',
    draft_subject: 'Hi Paul', draft_body: 'Following up, Paul.', draft_body_format: 'text',
  };

  it('renders the editable draft with a Send action, not outcome buttons', () => {
    render(<CadenceTaskDetails task={draftTask} onSendEmail={vi.fn()} />);
    expect(screen.getByLabelText('Email subject')).toHaveValue('Hi Paul');
    expect(screen.getByLabelText('Email body')).toHaveValue('Following up, Paul.');
    expect(screen.getByRole('button', { name: 'Send email' })).toBeInTheDocument();
  });

  it('sends the edited content, not the original draft', async () => {
    const user = userEvent.setup();
    const onSendEmail = vi.fn().mockResolvedValue();
    render(<CadenceTaskDetails task={draftTask} onSendEmail={onSendEmail} />);

    await user.clear(screen.getByLabelText('Email subject'));
    await user.type(screen.getByLabelText('Email subject'), 'Edited subject');
    await user.click(screen.getByRole('button', { name: 'Send email' }));

    expect(onSendEmail).toHaveBeenCalledWith('Edited subject', 'Following up, Paul.');
  });

  it('shows the sent/skipped state instead of the editor once done', () => {
    render(<CadenceTaskDetails task={{ ...draftTask, done: true }} onSendEmail={vi.fn()} />);
    expect(screen.getByText('Email sent')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email subject')).not.toBeInTheDocument();
  });

  it('shows the timeout outcome distinctly from a successful send', () => {
    render(<CadenceTaskDetails task={{ ...draftTask, done: true, outcome: 'missed_deadline' }} onSendEmail={vi.fn()} />);
    expect(screen.getByText(/Deadline passed/)).toBeInTheDocument();
  });

  it('ordinary task-step outcomes still render as before (regression guard)', () => {
    const taskStep = {
      id: 't2', done: false, description: 'Say hi on LinkedIn',
      outcome_options: [{ key: 'accepted', label: 'Accepted' }],
    };
    const onOutcome = vi.fn();
    render(<CadenceTaskDetails task={taskStep} onOutcome={onOutcome} />);
    expect(screen.getByText('Say hi on LinkedIn')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email subject')).not.toBeInTheDocument();
  });
});

describe('CadenceTaskDetails — a refused send', () => {
  const reason = "Can't send yet: Lead has no phone number. Your draft is kept — fix this, then send again.";

  it('SMS: shows the reason under Send and keeps the edited message', async () => {
    const user = userEvent.setup();
    const task = { id: 't2', done: false, kind: 'sms_approval', draft_body: 'Hi Paul', draft_body_format: 'text' };
    render(<CadenceTaskDetails task={task} onSendSms={vi.fn().mockRejectedValue(new Error(reason))} />);

    await user.type(screen.getByLabelText('SMS message'), '!');
    await user.click(screen.getByRole('button', { name: 'Send SMS' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
    expect(screen.getByLabelText('SMS message')).toHaveValue('Hi Paul!');
    expect(screen.getByRole('button', { name: 'Send SMS' })).toBeEnabled();
  });

  it('email: the error clears on the next attempt', async () => {
    const user = userEvent.setup();
    const task = { id: 't1', done: false, kind: 'email_approval', draft_subject: 'Hi', draft_body: 'Body', draft_body_format: 'text' };
    const onSendEmail = vi.fn().mockRejectedValueOnce(new Error(reason)).mockResolvedValueOnce();
    render(<CadenceTaskDetails task={task} onSendEmail={onSendEmail} />);

    await user.click(screen.getByRole('button', { name: 'Send email' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send email' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});


describe('CadenceTaskDetails — v13.7.0', () => {
  it('a formatted (HTML) draft is edited as formatted text, never as raw HTML', () => {
    const task = { id: 't3', done: false, kind: 'email_approval', draft_subject: 'Hi',
      draft_body: '<p>Hi <strong>Rehearsal</strong>,</p><p>Worth a chat?</p>', draft_body_format: 'html' };
    const { container } = render(<CadenceTaskDetails task={task} onSendEmail={vi.fn()} />);
    expect(screen.getByText('Worth a chat?')).toBeInTheDocument();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toContain('<p>');
  });

  it('offers Skip this step only when the caller can skip', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const task = { id: 't4', done: false, kind: 'sms_approval', draft_body: 'Hi' };
    const { rerender } = render(<CadenceTaskDetails task={task} onSendSms={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Skip this step' })).not.toBeInTheDocument();
    rerender(<CadenceTaskDetails task={task} onSendSms={vi.fn()} onSkip={onSkip} />);
    await user.click(screen.getByRole('button', { name: 'Skip this step' }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('the SMS editor counts characters and segments', () => {
    const task = { id: 't5', done: false, kind: 'sms_approval', draft_body: 'x'.repeat(161) };
    render(<CadenceTaskDetails task={task} onSendSms={vi.fn()} />);
    expect(screen.getByText('161 characters · 2 SMS')).toBeInTheDocument();
  });

  it('a skipped step says so, and nothing was sent', () => {
    const task = { id: 't6', done: true, outcome: 'skipped', kind: 'email_approval', draft_subject: 'Hi', draft_body: 'b' };
    render(<CadenceTaskDetails task={task} />);
    expect(screen.getByText('Skipped — nothing sent')).toBeInTheDocument();
  });

  it('picking an outcome reports the key', async () => {
    const user = userEvent.setup();
    const onOutcome = vi.fn().mockResolvedValue();
    const task = { id: 't7', done: false, description: 'Connect on LinkedIn',
      outcome_options: [{ key: 'accepted', label: 'Accepted' }, { key: 'not_accepted', label: 'Not accepted' }] };
    render(<CadenceTaskDetails task={task} onOutcome={onOutcome} />);
    await user.click(screen.getByRole('button', { name: 'Not accepted' }));
    expect(onOutcome).toHaveBeenCalledWith('not_accepted');
  });
});
