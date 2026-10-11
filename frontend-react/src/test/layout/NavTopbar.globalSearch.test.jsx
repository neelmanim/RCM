import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavTopbar } from '../../layout/NavTopbar';

// v14.0.0 — the top-bar search used to fire a request per pause with no cancelling and no stale-answer guard, so a slow
// early answer could overwrite a newer one and the list flashed empty between keystrokes.
describe('NavTopbar — global search behaves under typing', () => {
  const noop = () => {};
  const lead = (name) => ({ leads: [{ id: name, first_name: name, last_name: '', company: 'Acme', email: `${name}@a.com` }], users: [], accounts: [] });
  afterEach(() => { delete window._globalSearchFn; delete window._loadView; });
  beforeEach(() => { window._loadView = vi.fn(); });

  it('shows "Searching…" at once, then the results', async () => {
    window._globalSearchFn = vi.fn().mockResolvedValue(lead('Dana'));
    render(<NavTopbar userRole="SDR" onNavigate={noop} onAction={noop} />);
    await userEvent.type(screen.getByLabelText('Search'), 'Da');
    expect(screen.getByText('Searching…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Dana')).toBeInTheDocument());
  });

  it('ignores a slow answer for an older query and cancels it', async () => {
    let signals = [];
    window._globalSearchFn = vi.fn((q, signal) => {
      signals.push(signal);
      return q === 'da' ? new Promise((r) => setTimeout(() => r(lead('Stale')), 600)) : Promise.resolve(lead('Fresh'));
    });
    render(<NavTopbar userRole="SDR" onNavigate={noop} onAction={noop} />);
    const box = screen.getByLabelText('Search');
    await userEvent.type(box, 'da');
    await waitFor(() => expect(window._globalSearchFn).toHaveBeenCalledTimes(1));
    await userEvent.type(box, 'n');                       // "dan" supersedes "da"
    await waitFor(() => expect(screen.getByText('Fresh')).toBeInTheDocument());
    expect(signals[0].aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('serves a repeated query from memory instead of asking the server again', async () => {
    window._globalSearchFn = vi.fn().mockResolvedValue(lead('Dana'));
    render(<NavTopbar userRole="SDR" onNavigate={noop} onAction={noop} />);
    const box = screen.getByLabelText('Search');
    await userEvent.type(box, 'dan');
    await waitFor(() => expect(screen.getByText('Dana')).toBeInTheDocument());
    await userEvent.type(box, 'a{backspace}');            // back to "dan"
    await waitFor(() => expect(screen.getByText('Dana')).toBeInTheDocument());
    const asked = window._globalSearchFn.mock.calls.map((c) => c[0]);
    expect(asked.filter((q) => q === 'dan').length).toBe(1);
  });
});
