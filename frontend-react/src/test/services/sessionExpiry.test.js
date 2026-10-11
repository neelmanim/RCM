import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const original = window.location;
const reply = (status, detail) => (config) =>
  Promise.reject(Object.assign(new Error('x'), { config, response: { status, data: { detail } } }));

describe('an expired session signs the person out instead of leaving a dead page', () => {
  let api;
  beforeEach(async () => {
    vi.resetModules();   // the handler fires once per page load; each test is a fresh page
    api = (await import('../../services/api')).default;
    localStorage.setItem('crm_token', 'old');
    delete window.location;
    window.location = { href: 'https://app.test/#leads', reload: vi.fn() };
  });
  afterEach(() => { window.location = original; sessionStorage.clear(); localStorage.clear(); });

  it('clears the token and goes to login with the expired notice', async () => {
    await api.get('/leads', { adapter: reply(401, 'Invalid or expired token') }).catch(() => {});
    expect(localStorage.getItem('crm_token')).toBeNull();
    expect(window.location.href).toBe('login.html?expired=1');
  });

  it('does NOT sign out when the 401 came from a request sent before any login was stored (first sign-in)', async () => {
    localStorage.removeItem('crm_token');
    await api.get('/calls/my-active', { adapter: reply(401, 'Not authenticated') }).catch(() => {});
    expect(window.location.href).toBe('https://app.test/#leads');
  });

  it('does NOT sign out for an integration 401 (e.g. the email connection expired)', async () => {
    await api.get('/email/send', { adapter: reply(401, 'Email connection expired. Please reconnect your email.') }).catch(() => {});
    expect(localStorage.getItem('crm_token')).toBe('old');
    expect(window.location.href).toBe('https://app.test/#leads');
  });

  it('a View-as session that runs out drops back to the admin instead of logging out', async () => {
    sessionStorage.setItem('crm_view_as_token', 'viewas');
    await api.get('/leads', { adapter: reply(401, 'Invalid or expired token') }).catch(() => {});
    expect(sessionStorage.getItem('crm_view_as_token')).toBeNull();
    expect(localStorage.getItem('crm_token')).toBe('old');
    expect(window.location.reload).toHaveBeenCalled();
  });
});
