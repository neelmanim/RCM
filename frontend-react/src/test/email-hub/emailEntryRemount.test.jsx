import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';

// The real EmailHub fires network calls on mount; this test is about the
// mount/navigate contract in email-entry.jsx, not the page itself.
vi.mock('../../pages/Email/EmailHub', () => ({
  EmailHub: ({ leadId }) => <div data-testid="email-hub">hub for {leadId}</div>,
}));

/**
 * Reported live: "to send out mails via alternatecrm, everytime we need to
 * refresh the entire page".
 *
 * navigate() ignored its `container` argument and re-rendered into whatever
 * node mount() first attached to. lead_detail.js rebuilds
 * #emails-tab-content with innerHTML on every lead, and app.js only unmounts
 * EmailHub when *leaving* lead-detail — never lead-detail → lead-detail — so
 * going straight from one lead to another left the React root attached to the
 * previous, detached node. The Email tab rendered nowhere and sending was
 * impossible until a full reload reset the module's _mounted flag.
 */
describe('window.EmailHub mount/navigate contract', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete window.EmailHub;
    document.body.innerHTML = '';
    await import('../../email-entry.jsx');
  });

  afterEach(() => {
    act(() => window.EmailHub?.unmount());
  });

  /** What the shell does for each lead: a brand-new tab-content node. */
  function freshTabContent() {
    document.body.innerHTML = '<div id="tab-shell"><div id="emails-tab-content"></div></div>';
    return document.getElementById('emails-tab-content');
  }

  it('renders into the new container when the shell rebuilt the tab DOM', async () => {
    const first = freshTabContent();
    act(() => window.EmailHub.mount(first, { leadId: 'lead-A' }));
    expect(first.textContent).toContain('hub for lead-A');

    // Opening a second lead replaces the whole tab shell.
    const second = freshTabContent();
    expect(document.contains(first)).toBe(false);
    act(() => window.EmailHub.navigate(second, { leadId: 'lead-B' }));

    expect(second.textContent).toContain('hub for lead-B');
    expect(document.querySelectorAll('[data-testid="email-hub"]').length).toBe(1);
  });

  it('keeps the existing root when the same container is reused', async () => {
    const el = freshTabContent();
    act(() => window.EmailHub.mount(el, { leadId: 'lead-A' }));
    const mountedNode = el.querySelector('[data-testid="email-hub"]');

    act(() => window.EmailHub.navigate(el, { leadId: 'lead-B' }));

    // Same DOM node updated in place — navigate() exists precisely to avoid
    // a remount (and its API calls) when only the props changed.
    expect(el.querySelector('[data-testid="email-hub"]')).toBe(mountedNode);
    expect(el.textContent).toContain('hub for lead-B');
  });

  it('mounts cleanly again after unmount', async () => {
    const first = freshTabContent();
    act(() => window.EmailHub.mount(first, { leadId: 'lead-A' }));
    act(() => window.EmailHub.unmount());
    expect(window.EmailHub.isMounted).toBe(false);

    const second = freshTabContent();
    act(() => window.EmailHub.mount(second, { leadId: 'lead-C' }));
    expect(second.textContent).toContain('hub for lead-C');
  });
});
