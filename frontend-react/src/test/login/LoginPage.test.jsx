import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from '../../features/login/LoginPage';

function withLocation(url) {
  const original = window.location;
  const parsed = new URL(url);
  delete window.location;
  window.location = { origin: parsed.origin, search: parsed.search, pathname: parsed.pathname, href: url };
  return () => { window.location = original; };
}

describe('LoginPage', () => {
  let restoreLocation;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ allow_demo: false }) });
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    if (restoreLocation) restoreLocation();
    restoreLocation = null;
  });

  it('builds the Google OAuth link from the current origin', async () => {
    restoreLocation = withLocation('https://app.alternatecrm.test/login.html');
    render(<LoginPage />);
    const link = screen.getByText('Continue with Google').closest('a');
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/api/auth/login?origin=https%3A%2F%2Fapp.alternatecrm.test')
    );
  });

  it('tells the person their session ended when sent back to login', async () => {
    restoreLocation = withLocation('https://app.alternatecrm.test/login.html?expired=1');
    const toast = vi.fn();
    window.addEventListener('alternate:toast', toast);
    render(<LoginPage />);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0].detail.message).toMatch(/session has ended/i);
    window.removeEventListener('alternate:toast', toast);
  });

  it('saves the token from the URL and redirects when returning from Google on the same origin', async () => {
    restoreLocation = withLocation('https://app.alternatecrm.test/login.html?token=abc123');
    render(<LoginPage />);
    await waitFor(() => expect(localStorage.getItem('crm_token')).toBe('abc123'));
    expect(window.location.href).toBe('index.html');
  });

  it('shows an access-denied toast for ?error=unauthorized', async () => {
    restoreLocation = withLocation('https://app.alternatecrm.test/login.html?error=unauthorized');
    render(<LoginPage />);
    expect(await screen.findByText(/we've let your admin know/i)).toBeInTheDocument();
  });

  // 2026-09-29: demo login was deleted (backend route + this UI), not just
  // switched off by an env flag.
  it('has no demo access at all and never asks the backend about it', async () => {
    render(<LoginPage />);
    expect(screen.queryByText('Quick Access')).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/config'));
  });
});
