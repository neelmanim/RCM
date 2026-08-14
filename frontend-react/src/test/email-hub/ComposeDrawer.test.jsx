import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComposeDrawer } from '../../pages/Email/ComposeDrawer';

const lead = { id: 'lead-1', email: 'jane@lead.com', first_name: 'Jane' };

function typeIntoEditable(selector, text) {
  const el = document.querySelector(selector);
  act(() => {
    el.focus();
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ComposeDrawer', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });

  it('sends cc/bcc as form fields when the Cc/Bcc row is filled in', async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    render(<ComposeDrawer lead={lead} token="tok" apiBase="" onSent={onSent} onClose={() => {}} />);

    await user.type(screen.getByPlaceholderText('Subject'), 'Hello');
    await user.click(screen.getByText('Cc/Bcc'));
    await user.type(screen.getByPlaceholderText('Cc (optional)'), 'manager@co.com');
    await user.type(screen.getByPlaceholderText('Bcc (optional)'), 'archive@co.com');
    typeIntoEditable('.eh-compose-body', 'Hi Jane, following up.');

    await user.click(screen.getByText('✉ Send Email'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, opts] = global.fetch.mock.calls[0];
    const form = opts.body;
    expect(form.get('cc')).toBe('manager@co.com');
    expect(form.get('bcc')).toBe('archive@co.com');
    expect(form.get('body')).toContain('Hi Jane, following up.');
  });

  it('omits cc/bcc form fields when not provided', async () => {
    const user = userEvent.setup();
    render(<ComposeDrawer lead={lead} token="tok" apiBase="" onSent={() => {}} onClose={() => {}} />);

    await user.type(screen.getByPlaceholderText('Subject'), 'Hello');
    typeIntoEditable('.eh-compose-body', 'Just checking in');

    await user.click(screen.getByText('✉ Send Email'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, opts] = global.fetch.mock.calls[0];
    const form = opts.body;
    expect(form.has('cc')).toBe(false);
    expect(form.has('bcc')).toBe(false);
    expect(form.get('subject')).toBe('Hello');
  });
});
