import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplyComposer } from '../../pages/Email/ReplyComposer';

const thread = {
  subject: 'Intro',
  lead_id: 'lead-1',
  lead_email: 'jane@lead.com',
  nylas_thread_id: 'thread-1',
};

function typeIntoEditable(selector, text) {
  const el = document.querySelector(selector);
  act(() => {
    el.focus();
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ReplyComposer', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    Element.prototype.scrollIntoView = vi.fn(); // jsdom doesn't implement this
  });

  it('sends cc/bcc when the reply Cc/Bcc row is filled in', async () => {
    const user = userEvent.setup();
    render(<ReplyComposer thread={thread} token="tok" apiBase="" onSent={() => {}} />);

    await user.click(screen.getByText('↩ Reply'));
    await user.click(screen.getByText('Cc/Bcc'));
    await user.type(screen.getByPlaceholderText('Cc (optional)'), 'manager@co.com');
    typeIntoEditable('.eh-reply-textarea', 'Sounds good, thanks!');

    await user.click(screen.getByText('✉ Send Reply'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, opts] = global.fetch.mock.calls[0];
    const form = opts.body;
    expect(form.get('cc')).toBe('manager@co.com');
    expect(form.get('thread_id')).toBe('thread-1');
    expect(form.get('body')).toContain('Sounds good, thanks!');
  });

  it('disallows reply when the thread has no nylas_thread_id', () => {
    render(<ReplyComposer thread={{ ...thread, nylas_thread_id: null }} token="tok" apiBase="" onSent={() => {}} />);
    expect(screen.getByText(/Reply unavailable/)).toBeTruthy();
  });
});
